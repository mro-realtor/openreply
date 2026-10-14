/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1.
 * Covers the campaign settings through REST services, MCP tools and the dashboard routes.
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
import { generateApiToken } from "@/lib/api/tokens";
import type { ApiContext } from "@/lib/api/types";
import { createDraftSchema } from "@/lib/services/campaign-schemas";
import { createDraftCampaign, getCampaign, updateDraftCampaign } from "@/lib/services/campaigns";
import { createMcpServer } from "@/lib/mcp/server";
import { PATCH as dashboardPatch, POST as dashboardPost } from "@/app/api/automations/route";

const enabled = process.env.RUN_DB_TESTS === "1";
const suffix = Math.random().toString(36).slice(2, 8);

interface Tenant {
  ownerId: string;
  nancyId: string;
  strangerId: string;
  workspaceId: string;
  accountId: string;
  username: string;
  ctx: ApiContext;
}

async function makeTenant(): Promise<Tenant> {
  const mk = async (who: string) =>
    (await prisma.user.create({ data: { email: `settings-${who}-${suffix}@example.test` } })).id;
  const ownerId = await mk("owner");
  const nancyId = await mk("nancy");
  const strangerId = await mk("stranger");
  const workspace = await prisma.workspace.create({
    data: {
      name: `settings-${suffix}`,
      ownerId,
      members: { create: [{ userId: ownerId, role: "OWNER" }, { userId: nancyId, role: "MEMBER" }] },
    },
  });
  const username = `settings.${suffix}`;
  const account = await prisma.instagramAccount.create({
    data: {
      workspaceId: workspace.id,
      instagramId: `ig-settings-${suffix}`,
      username,
      accessToken: "enc-secret-value-must-never-leak",
      tokenExpiresAt: new Date(Date.now() + 40 * 86_400_000),
    },
  });
  const generated = generateApiToken();
  const token = await prisma.apiToken.create({
    data: {
      workspaceId: workspace.id,
      createdByUserId: ownerId,
      name: "settings token",
      tokenPrefix: generated.displayPrefix,
      tokenHash: generated.hash,
      scopes: ["read", "drafts:write"],
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return {
    ownerId, nancyId, strangerId,
    workspaceId: workspace.id,
    accountId: account.id,
    username,
    ctx: { workspaceId: workspace.id, tokenId: token.id, tokenName: token.name, scopes: ["read", "drafts:write"], createdByUserId: ownerId },
  };
}

async function mcp(ctx: ApiContext) {
  const server = createMcpServer(prisma, ctx);
  const client = new Client({ name: "settings-test", version: "1" });
  const [x, y] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(x), client.connect(y)]);
  return async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { isError: Boolean(res.isError), body: JSON.parse(res.content[0].text) as Record<string, any> };
  };
}

const json = (method: string, url: string, body: object) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe.skipIf(!enabled)("campaign settings through REST, MCP and the dashboard (database)", () => {
  let t: Tenant;

  beforeAll(async () => {
    t = await makeTenant();
    state.ctx = { userId: t.ownerId, workspaceId: t.workspaceId, role: "OWNER" };
  });

  afterAll(async () => {
    if (!t) return;
    await prisma.workspace.deleteMany({ where: { id: t.workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [t.ownerId, t.nancyId, t.strangerId] } } });
  });

  it("REST service stores the settings on an inactive draft and shows them", async () => {
    const dto = await createDraftCampaign(
      prisma,
      { ctx: t.ctx, channel: "REST" },
      createDraftSchema.parse({
        instagramUsername: t.username, name: "rest settings", keywords: ["CASA"], dmMessage: "Hola!",
        requireFollow: true, followPromptMessage: "follow first", followGateStrict: true, defaultAssigneeUserId: t.nancyId,
      })
    );
    expect(dto.status).toBe("draft");
    expect(dto.followGate).toMatchObject({ enabled: true, strict: true });
    expect(dto.settings).toEqual({ textOnly: false, defaultAssigneeUserId: t.nancyId });
    const row = await prisma.automation.findUniqueOrThrow({ where: { id: dto.id } });
    expect(row).toMatchObject({ isActive: false, isDraft: true, followGateStrict: true, defaultAssigneeUserId: t.nancyId });
  });

  it("MCP creates a text-only draft and can read the settings back", async () => {
    const call = await mcp(t.ctx);
    const created = await call("create_draft_campaign", {
      instagramUsername: t.username, name: "mcp text only", keywords: ["LINK"], dmMessage: "Here: {link}",
      textOnly: true, defaultAssigneeUserId: t.nancyId,
    });
    expect(created.isError).toBe(false);
    expect(created.body.status).toBe("draft");
    const read = await call("get_campaign", { campaignId: created.body.id });
    expect(read.body.settings).toEqual({ textOnly: true, defaultAssigneeUserId: t.nancyId });
    const row = await prisma.automation.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ isActive: false, isDraft: true, textOnly: true });
  });

  it("MCP refuses a teammate outside the workspace and creates nothing", async () => {
    const call = await mcp(t.ctx);
    const before = await prisma.automation.count({ where: { workspaceId: t.workspaceId } });
    const res = await call("create_draft_campaign", {
      instagramUsername: t.username, name: "bad assignee", keywords: ["X"], dmMessage: "hi", defaultAssigneeUserId: t.strangerId,
    });
    expect(res.isError).toBe(true);
    expect(await prisma.automation.count({ where: { workspaceId: t.workspaceId } })).toBe(before);
  });

  it("refuses setting combinations that cannot work, on create and on update", async () => {
    const call = await mcp(t.ctx);
    const strictNoGate = await call("create_draft_campaign", {
      instagramUsername: t.username, name: "strict no gate", keywords: ["X"], dmMessage: "hi", followGateStrict: true,
    });
    expect(strictNoGate.isError).toBe(true);

    const ok = await call("create_draft_campaign", {
      instagramUsername: t.username, name: "gate then text", keywords: ["X"], dmMessage: "hi", requireFollow: true, followPromptMessage: "follow",
    });
    expect(ok.isError).toBe(false);
    const bad = await call("update_draft_campaign", { campaignId: ok.body.id, textOnly: true });
    expect(bad.isError).toBe(true);
    const fixed = await call("update_draft_campaign", { campaignId: ok.body.id, requireFollow: false, textOnly: true });
    expect(fixed.isError).toBe(false);
    expect(await prisma.automation.findUniqueOrThrow({ where: { id: ok.body.id } })).toMatchObject({
      requireFollow: false, followGateStrict: false, textOnly: true, isActive: false, isDraft: true,
    });
  });

  it("an API client can never turn a draft on", async () => {
    const call = await mcp(t.ctx);
    const created = await call("create_draft_campaign", { instagramUsername: t.username, name: "stay off", keywords: ["X"], dmMessage: "hi" });
    const res = await call("update_draft_campaign", { campaignId: created.body.id, isActive: true });
    expect(res.isError).toBe(true);
    expect((await getCampaign(prisma, t.ctx, created.body.id)).status).toBe("draft");
  });

  it("an update through the service re-checks against the saved draft", async () => {
    const dto = await createDraftCampaign(prisma, { ctx: t.ctx, channel: "REST" }, createDraftSchema.parse({
      instagramUsername: t.username, name: "svc update", keywords: ["X"], dmMessage: "hi", requireFollow: true, followPromptMessage: "f",
    }));
    const err = await updateDraftCampaign(prisma, { ctx: t.ctx, channel: "REST" }, dto.id, { textOnly: true }).catch((e) => e);
    expect(err.status).toBe(400);
  });

  it("dashboard: Save Draft keeps an unfinished campaign off, and going live lists what is missing", async () => {
    const created = await dashboardPost(json("POST", "http://localhost/api/automations", {
      name: "dashboard draft", instagramAccountId: t.accountId, dmMessage: "Hello", isDraft: true, isActive: true,
      defaultAssigneeUserId: t.nancyId,
    }));
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    const id = createdBody.data.id as string;
    expect(await prisma.automation.findUniqueOrThrow({ where: { id } })).toMatchObject({
      isActive: false, isDraft: true, defaultAssigneeUserId: t.nancyId,
    });

    const patch = (body: object) => dashboardPatch(json("PATCH", `http://localhost/api/automations?id=${id}`, body));
    const tooEarly = await patch({ isActive: true });
    expect(tooEarly.status).toBe(400);
    const earlyBody = await tooEarly.json();
    expect(earlyBody.missing).toEqual(["a keyword, or match any word"]);
    expect((await prisma.automation.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);

    const live = await patch({ matchAnyWord: true, matchAnyPost: true, isActive: true });
    expect(live.status).toBe(200);
    expect(await prisma.automation.findUniqueOrThrow({ where: { id } })).toMatchObject({ isActive: true, isDraft: false });
  });

  it("dashboard refuses a teammate from another workspace", async () => {
    const res = await dashboardPost(json("POST", "http://localhost/api/automations", {
      name: "dashboard bad assignee", instagramAccountId: t.accountId, dmMessage: "Hello", isDraft: true,
      defaultAssigneeUserId: t.strangerId,
    }));
    expect(res.status).toBe(400);
  });
});
