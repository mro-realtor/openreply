/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1
 * (set by .github/workflows/validate-api-mcp.yml). Never point it at production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const state = vi.hoisted(() => ({
  ctx: null as null | { userId: string; workspaceId: string; role: "OWNER" },
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: async () => state.ctx,
  canManageWorkspace: () => true,
  canManageBilling: () => true,
}));
vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: async () => state.ctx?.workspaceId ?? null,
  getCurrentUserId: async () => state.ctx?.userId ?? null,
}));

import { prisma } from "@/lib/db/client";
import { authenticateBearer } from "@/lib/api/auth";
import { generateApiToken } from "@/lib/api/tokens";
import { withIdempotency } from "@/lib/api/idempotency";
import type { RateLimitStore } from "@/lib/api/rate-limit";
import type { ApiContext } from "@/lib/api/types";
import { createDraftSchema, updateDraftSchema } from "@/lib/services/campaign-schemas";
import { NEXT_REEL_BINDABLE_WHERE } from "@/lib/services/campaign-mapper";
import {
  createDraftCampaign,
  getCampaign,
  listCampaigns,
  updateDraftCampaign,
} from "@/lib/services/campaigns";
import { listAccounts } from "@/lib/services/accounts";
import { listCampaignLogs } from "@/lib/services/logs";
import { createMcpServer } from "@/lib/mcp/server";
import { PATCH as dashboardPatch } from "@/app/api/automations/route";

const enabled = process.env.RUN_DB_TESTS === "1";
const suffix = Math.random().toString(36).slice(2, 8);
const memoryStore: RateLimitStore = { increment: async () => 1 };

interface Tenant {
  userId: string;
  workspaceId: string;
  accountId: string;
  username: string;
  token: string;
  tokenId: string;
  ctx: ApiContext;
}

async function makeTenant(label: string, scopes: string[]): Promise<Tenant> {
  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.test` },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: `${label}-${suffix}`,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const username = `${label}.${suffix}`;
  const account = await prisma.instagramAccount.create({
    data: {
      workspaceId: workspace.id,
      instagramId: `ig-${label}-${suffix}`,
      username,
      accessToken: "enc-secret-value-must-never-leak",
      tokenExpiresAt: new Date(Date.now() + 40 * 86_400_000),
    },
  });
  const generated = generateApiToken();
  const token = await prisma.apiToken.create({
    data: {
      workspaceId: workspace.id,
      createdByUserId: user.id,
      name: `${label} token`,
      tokenPrefix: generated.displayPrefix,
      tokenHash: generated.hash,
      scopes,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const ctx = await authenticateBearer(prisma, `Bearer ${generated.secret}`, {
    rateLimitStore: memoryStore,
  });
  return {
    userId: user.id,
    workspaceId: workspace.id,
    accountId: account.id,
    username,
    token: generated.secret,
    tokenId: token.id,
    ctx,
  };
}

const draftInput = (t: Tenant, name: string, extra: Record<string, unknown> = {}) =>
  createDraftSchema.parse({
    instagramUsername: t.username,
    name,
    keywords: ["CASA"],
    dmMessage: "Hola!",
    ...extra,
  });

describe.skipIf(!enabled)("database integration", () => {
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    a = await makeTenant("tenant-a", ["read", "drafts:write"]);
    b = await makeTenant("tenant-b", ["read", "drafts:write"]);
  });

  afterAll(async () => {
    for (const t of [a, b]) {
      if (!t) continue;
      await prisma.workspace.deleteMany({ where: { id: t.workspaceId } });
      await prisma.user.deleteMany({ where: { id: t.userId } });
    }
    await prisma.auditLog.deleteMany({
      where: { workspaceId: { in: [a?.workspaceId, b?.workspaceId].filter(Boolean) as string[] } },
    });
  });

  it("authenticates by token hash and rejects revoked and expired tokens", async () => {
    expect(a.ctx.workspaceId).toBe(a.workspaceId);

    const extra = generateApiToken();
    const rec = await prisma.apiToken.create({
      data: {
        workspaceId: a.workspaceId,
        name: "short lived",
        tokenPrefix: extra.displayPrefix,
        tokenHash: extra.hash,
        scopes: ["read"],
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await authenticateBearer(prisma, `Bearer ${extra.secret}`, { rateLimitStore: memoryStore });

    await prisma.apiToken.update({ where: { id: rec.id }, data: { revokedAt: new Date() } });
    const revoked = await authenticateBearer(prisma, `Bearer ${extra.secret}`, { rateLimitStore: memoryStore }).catch((e) => e);
    expect(revoked.status).toBe(401);

    await prisma.apiToken.update({
      where: { id: rec.id },
      data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await authenticateBearer(prisma, `Bearer ${extra.secret}`, { rateLimitStore: memoryStore }).catch((e) => e);
    expect(expired.status).toBe(401);
  });

  it("stores only a hash, never the token secret", async () => {
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: a.tokenId } });
    expect(JSON.stringify(row)).not.toContain(a.token);
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates an inactive draft with no reel and audits it", async () => {
    const dto = await createDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, draftInput(a, "NOR | CASA", {
      draftConfig: { conversationMode: "direct_capture", assignee: "Nancy Orellana" },
    }));
    expect(dto.status).toBe("draft");
    const row = await prisma.automation.findUniqueOrThrow({ where: { id: dto.id } });
    expect(row).toMatchObject({ isActive: false, isDraft: true, postId: null, matchAnyPost: false, workspaceId: a.workspaceId });
    expect(row.reportShareSlug).toBeTruthy();

    const audit = await prisma.auditLog.findMany({
      where: { workspaceId: a.workspaceId, action: "campaign.draft.create" },
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain("orp_");
  });

  it("keeps workspaces isolated", async () => {
    const mine = await createDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, draftInput(a, "A private"));
    const read = await getCampaign(prisma, b.ctx, mine.id).catch((e) => e);
    expect(read.status).toBe(404);
    const edit = await updateDraftCampaign(prisma, { ctx: b.ctx, channel: "REST" }, mine.id, updateDraftSchema.parse({ name: "hijack" })).catch((e) => e);
    expect(edit.status).toBe(404);
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: mine.id } })).name).toBe("A private");

    const cross = await createDraftCampaign(prisma, { ctx: b.ctx, channel: "REST" }, draftInput(a, "steal account")).catch((e) => e);
    expect(cross.status).toBe(400);

    const listB = await listCampaigns(prisma, b.ctx, {});
    expect(listB.items.some((c) => c.id === mine.id)).toBe(false);
  });

  it("never returns stored credentials from account listings", async () => {
    const accounts = await listAccounts(prisma, a.ctx, {});
    expect(accounts.items).toHaveLength(1);
    expect(JSON.stringify(accounts)).not.toMatch(/enc-secret-value-must-never-leak|accessToken/);
  });

  it("refuses to edit a campaign once a person has activated it", async () => {
    const dto = await createDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, draftInput(a, "to activate"));
    await prisma.automation.update({ where: { id: dto.id }, data: { isActive: true, isDraft: false } });
    const err = await updateDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, dto.id, updateDraftSchema.parse({ name: "nope" })).catch((e) => e);
    expect(err.code).toBe("CAMPAIGN_NOT_DRAFT");
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: dto.id } })).name).toBe("to activate");
  });

  it("pages through results without gaps or repeats", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await createDraftCampaign(prisma, { ctx: b.ctx, channel: "REST" }, draftInput(b, `page-${i}`));
    }
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listCampaigns(prisma, b.ctx, { limit: 2, cursor });
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    const total = await prisma.automation.count({ where: { workspaceId: b.workspaceId } });
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it("creates exactly one campaign when identical requests arrive together", async () => {
    const input = draftInput(a, "idempotent once");
    const run = () =>
      withIdempotency(prisma, a.ctx, "idem-key-00001", "POST /api/v1/campaigns", input, async () => ({
        status: 201,
        body: await createDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, input),
      }));
    await Promise.allSettled([run(), run()]);
    const replay = await run();
    expect(replay.replayed).toBe(true);
    expect(await prisma.automation.count({ where: { workspaceId: a.workspaceId, name: "idempotent once" } })).toBe(1);
  });

  it("keeps commenter identities out of delivery logs", async () => {
    const dto = await createDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, draftInput(a, "logs"));
    await prisma.dmLog.create({
      data: {
        workspaceId: a.workspaceId, automationId: dto.id, instagramAccountId: a.accountId,
        commenterId: "ig-user-999", commenterName: "Jane Secret", commentText: "call me 555-0100",
        commentId: `c-${suffix}`, status: "SENT",
      },
    });
    const logs = await listCampaignLogs(prisma, a.ctx, { campaignId: dto.id });
    expect(logs.items).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toMatch(/Jane Secret|555-0100|ig-user-999|commenter/i);
  });

  it("excludes drafts from next-reel binding but not other campaigns", async () => {
    const draft = await createDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, draftInput(a, "next reel draft", { pendingNextReel: true }));
    const live = await prisma.automation.create({
      data: {
        name: "live next reel", dmMessage: "hi", workspaceId: a.workspaceId,
        instagramAccountId: a.accountId, pendingNextReel: true, isActive: false, isDraft: false,
      },
    });
    const bindable = await prisma.automation.findMany({
      where: { ...NEXT_REEL_BINDABLE_WHERE, workspaceId: a.workspaceId },
      select: { id: true },
    });
    const ids = bindable.map((r) => r.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(draft.id);
  });

  it("dashboard save keeps a draft inactive; only an explicit go-live activates it", async () => {
    state.ctx = { userId: a.userId, workspaceId: a.workspaceId, role: "OWNER" };
    const dto = await createDraftCampaign(prisma, { ctx: a.ctx, channel: "REST" }, draftInput(a, "dashboard test"));

    const patch = (body: object) =>
      dashboardPatch(new NextRequest(`http://localhost/api/automations?id=${dto.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }));

    const save = await patch({ name: "dashboard renamed", isActive: false });
    expect(save.status).toBe(200);
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: dto.id } })).toMatchObject({ isActive: false, isDraft: true, name: "dashboard renamed" });

    const live = await patch({ isActive: true });
    expect(live.status).toBe(200);
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: dto.id } })).toMatchObject({ isActive: true, isDraft: false });
  });

  it("serves the MCP tools over the same services with workspace scoping", async () => {
    const server = createMcpServer(prisma, a.ctx);
    const client = new Client({ name: "db-test", version: "1" });
    const [x, y] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(x), client.connect(y)]);
    const res = (await client.callTool({ name: "list_campaigns", arguments: { status: "draft" } })) as { content: { text: string }[] };
    const body = JSON.parse(res.content[0].text) as { items: { account: { username: string } }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((c) => c.account.username === a.username)).toBe(true);
  });
});
