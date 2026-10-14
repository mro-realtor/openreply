/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1.
 * Covers the read-only contacts API, MCP tools and dashboard history:
 * workspace isolation, scopes, search, pagination, identity mapping and consent visibility.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "@/lib/db/client";
import type { ApiContext } from "@/lib/api/types";
import { assignContact, listContactHistory, recordConsent } from "@/lib/contacts/manage";
import { resolveContact } from "@/lib/contacts/service";
import { createMcpServer } from "@/lib/mcp/server";
import { getContactForApi, listContactHistoryForApi, listContactsForApi } from "@/lib/services/contacts";

const enabled = process.env.RUN_DB_TESTS === "1";
const suffix = randomBytes(4).toString("hex");
let seq = 0;

interface Tenant {
  workspaceId: string;
  ownerId: string;
  nancyId: string;
  accountId: string;
  automationId: string;
  ctx: ApiContext;
}

const userIds: string[] = [];
const workspaceIds: string[] = [];

async function tenant(label: string, scopes = ["read", "contacts:read"]): Promise<Tenant> {
  const mk = async (who: string) => {
    const u = await prisma.user.create({ data: { email: `${label}-${who}-${suffix}-${++seq}@example.test` } });
    userIds.push(u.id);
    return u.id;
  };
  const ownerId = await mk("owner");
  const nancyId = await mk("nancy");
  const ws = await prisma.workspace.create({
    data: {
      name: `${label}-${suffix}`,
      ownerId,
      members: { create: [{ userId: ownerId, role: "OWNER" }, { userId: nancyId, role: "MEMBER" }] },
    },
  });
  workspaceIds.push(ws.id);
  const acct = await prisma.instagramAccount.create({
    data: { workspaceId: ws.id, instagramId: `ig-${label}-${suffix}`, username: `${label}.${suffix}`, accessToken: "enc-never-leak" },
  });
  const auto = await prisma.automation.create({
    data: { name: `${label} campaign`, dmMessage: "hi", workspaceId: ws.id, instagramAccountId: acct.id, isActive: false, isDraft: true },
  });
  return {
    workspaceId: ws.id,
    ownerId,
    nancyId,
    accountId: acct.id,
    automationId: auto.id,
    ctx: { workspaceId: ws.id, tokenId: `tok-${label}`, tokenName: label, scopes, createdByUserId: ownerId },
  };
}

async function person(t: Tenant, externalId: string, handle: string, displayName?: string) {
  return resolveContact(prisma, { workspaceId: t.workspaceId, platform: "INSTAGRAM", externalId, handle, displayName: displayName ?? handle });
}

async function dm(t: Tenant, contactId: string | null, commenterId: string, text: string, status: "SENT" | "FAILED" = "SENT") {
  return prisma.dmLog.create({
    data: {
      workspaceId: t.workspaceId,
      automationId: t.automationId,
      instagramAccountId: t.accountId,
      commenterId,
      commentText: text,
      commentId: `cm-${suffix}-${++seq}`,
      contactId,
      matchedKeyword: "CASA",
      status,
      dmSentAt: status === "SENT" ? new Date() : null,
      errorMessage: status === "FAILED" ? "Bearer abcdef0123456789abcdef0123456789 rejected" : null,
    },
  });
}

async function mcp(ctx: ApiContext) {
  const server = createMcpServer(prisma, ctx);
  const client = new Client({ name: "contacts-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const body = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0].text);

describe.skipIf(!enabled)("contacts API, MCP and history (database)", () => {
  let a: Tenant;
  let b: Tenant;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    a = await tenant("alpha");
    b = await tenant("bravo");
    ids.ana = (await person(a, `ig-ana-${suffix}`, "ana.casa", "Ana Lopez")).id;
    ids.beto = (await person(a, `ig-beto-${suffix}`, "beto_homes", "Beto Ruiz")).id;
    ids.cy = (await person(a, `ig-cy-${suffix}`, "cy.sells")).id;
    ids.other = (await person(b, `ig-other-${suffix}`, "ana.casa", "Ana Lopez")).id;
    await dm(a, ids.ana, `ig-ana-${suffix}`, "Hola quiero CASA, mi correo es ana@example.test");
    await dm(a, ids.ana, `ig-ana-${suffix}`, "CASA otra vez", "FAILED");
    await dm(b, ids.other, `ig-other-${suffix}`, "bravo private comment");
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("lists only the caller's workspace, even when the same handle exists elsewhere", async () => {
    const mine = await listContactsForApi(prisma, a.ctx, { q: "ana.casa" });
    expect(mine.items.map((c) => c.id)).toEqual([ids.ana]);
    const theirs = await listContactsForApi(prisma, b.ctx, { q: "ana.casa" });
    expect(theirs.items.map((c) => c.id)).toEqual([ids.other]);
    const all = await listContactsForApi(prisma, a.ctx, {});
    expect(all.items.map((c) => c.id)).not.toContain(ids.other);
  });

  it("answers not found for another workspace's contact, detail and history", async () => {
    await expect(getContactForApi(prisma, a.ctx, ids.other)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(listContactHistoryForApi(prisma, a.ctx, ids.other, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    const dash = await listContactHistory(prisma, { workspaceId: a.workspaceId, contactId: ids.other, includeContent: true });
    expect(dash).toMatchObject({ ok: false, status: 404 });
  });

  it("searches by name, handle and exact platform id", async () => {
    expect((await listContactsForApi(prisma, a.ctx, { q: "lopez" })).items.map((c) => c.id)).toEqual([ids.ana]);
    expect((await listContactsForApi(prisma, a.ctx, { q: "BETO_" })).items.map((c) => c.id)).toEqual([ids.beto]);
    expect((await listContactsForApi(prisma, a.ctx, { q: `ig-cy-${suffix}` })).items.map((c) => c.id)).toEqual([ids.cy]);
    expect((await listContactsForApi(prisma, a.ctx, { q: "nobody-matches" })).items).toEqual([]);
  });

  it("looks up one linked identity exactly, never across workspaces", async () => {
    const hit = await listContactsForApi(prisma, a.ctx, { identity: `INSTAGRAM:ig-beto-${suffix}` });
    expect(hit.items.map((c) => c.id)).toEqual([ids.beto]);
    const miss = await listContactsForApi(prisma, a.ctx, { identity: `INSTAGRAM:ig-other-${suffix}` });
    expect(miss.items).toEqual([]);
    await expect(listContactsForApi(prisma, a.ctx, { identity: "beto_homes" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(listContactsForApi(prisma, a.ctx, { identity: "TIKTOK:1" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("pages with a cursor without repeating or skipping anyone", async () => {
    const big = await tenant("pager");
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push((await person(big, `ig-p-${i}-${suffix}`, `pager${i}`)).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listContactsForApi(prisma, big.ctx, { limit: 3, cursor });
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...made].sort());
    await expect(listContactsForApi(prisma, big.ctx, { cursor: "garbage" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("maps one external id to one contact and never merges by name or handle", async () => {
    const t = await tenant("ident");
    const first = await person(t, `ig-same-${suffix}`, "old_handle", "Sam");
    const again = await person(t, `ig-same-${suffix}`, "new_handle", "Sam");
    expect(again.id).toBe(first.id);
    const lookalike = await person(t, `ig-lookalike-${suffix}`, "new_handle", "Sam");
    expect(lookalike.id).not.toBe(first.id);

    const detail = await getContactForApi(prisma, t.ctx, first.id);
    expect(detail.identities).toHaveLength(1);
    expect(detail.identities[0]).toMatchObject({ platform: "INSTAGRAM", externalId: `ig-same-${suffix}`, handle: "new_handle" });
    expect(detail.id).toBe(first.id);
    expect((await listContactsForApi(prisma, t.ctx, { q: "Sam" })).items).toHaveLength(2);
  });

  it("shows Instagram DM consent and opt-out without implying SMS or voice consent", async () => {
    const t = await tenant("consent");
    const c = await person(t, `ig-c-${suffix}`, "consenting");
    const before = await getContactForApi(prisma, t.ctx, c.id);
    expect(before.consent.instagramDm.status).toBe("UNKNOWN");
    expect(before.consent.sms.status).toBe("NOT_TRACKED");
    expect(before.followUpState).toBe("UNASSIGNED");

    await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "GRANTED", source: "dm_reply", recordedByUserId: t.ownerId });
    const granted = await getContactForApi(prisma, t.ctx, c.id);
    expect(granted.consent.instagramDm).toMatchObject({ status: "GRANTED", source: "dm_reply" });
    expect(granted.consent.sms).toEqual({ status: "NOT_TRACKED" });
    expect(granted.consent.voice).toEqual({ status: "NOT_TRACKED" });
    expect(granted.consentHistory[0]).toMatchObject({ channel: "instagram_dm", status: "GRANTED", source: "dm_reply" });

    await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "WITHDRAWN", source: "manual" });
    const out = await getContactForApi(prisma, t.ctx, c.id);
    expect(out.optOut).toMatchObject({ optedOut: true, channel: "instagram_dm" });
    expect(out.followUpState).toBe("OPTED_OUT");
    const opted = await listContactsForApi(prisma, t.ctx, { status: "OPTED_OUT" });
    expect(opted.items.map((x) => x.id)).toEqual([c.id]);
    expect(out.consent.sms.status).toBe("NOT_TRACKED");
  });

  it("filters by assignee and reports the follow up state", async () => {
    const t = await tenant("assign");
    const c = await person(t, `ig-a-${suffix}`, "assignee");
    await person(t, `ig-b-${suffix}`, "unowned");
    await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.nancyId });
    const mine = await listContactsForApi(prisma, t.ctx, { assignedTo: t.nancyId });
    expect(mine.items.map((x) => x.id)).toEqual([c.id]);
    expect(mine.items[0]).toMatchObject({ assignedToUserId: t.nancyId, followUpState: "ASSIGNED" });
    expect((await listContactsForApi(prisma, t.ctx, { assignedTo: "unassigned" })).items).toHaveLength(1);
  });

  it("returns history without comment text to tokens, and with it only to the dashboard", async () => {
    const api = await listContactHistoryForApi(prisma, a.ctx, ids.ana, {});
    expect(api.items).toHaveLength(2);
    const text = JSON.stringify(api);
    expect(text).not.toMatch(/ana@example\.test|Hola quiero|otra vez|commentText/);
    expect(text).not.toMatch(/abcdef0123456789abcdef0123456789/);
    expect(api.items[0]).toMatchObject({ channel: "instagram_dm", campaign: { name: "alpha campaign" } });

    const dash = await listContactHistory(prisma, { workspaceId: a.workspaceId, contactId: ids.ana, includeContent: true });
    expect(dash.ok).toBe(true);
    if (dash.ok) expect(dash.value.items.map((i) => i.commentText).sort()).toEqual(["CASA otra vez", "Hola quiero CASA, mi correo es ana@example.test"]);
  });

  it("never exposes credentials or other workspace data in any response", async () => {
    const text = JSON.stringify([
      await listContactsForApi(prisma, a.ctx, {}),
      await getContactForApi(prisma, a.ctx, ids.ana),
      await listContactHistoryForApi(prisma, a.ctx, ids.ana, {}),
    ]);
    expect(text).not.toMatch(/enc-never-leak|accessToken|bravo private|workspaceId/);
  });

  it("reading never sends, writes or changes anything", async () => {
    const snapshot = async () => ({
      dm: await prisma.dmLog.count({ where: { workspaceId: a.workspaceId } }),
      consent: await prisma.contactConsentEvent.count({ where: { contact: { workspaceId: a.workspaceId } } }),
      contacts: await prisma.contact.findMany({ where: { workspaceId: a.workspaceId }, select: { id: true, updatedAt: true, lastDmSentAt: true }, orderBy: { id: "asc" } }),
    });
    const before = await snapshot();
    await listContactsForApi(prisma, a.ctx, { q: "ana" });
    await getContactForApi(prisma, a.ctx, ids.ana);
    await listContactHistoryForApi(prisma, a.ctx, ids.ana, {});
    const client = await mcp(a.ctx);
    await client.callTool({ name: "list_contacts", arguments: {} });
    await client.callTool({ name: "get_contact", arguments: { contactId: ids.ana } });
    expect(await snapshot()).toEqual(before);
  });

  it("MCP tools work with contacts:read, respect isolation and audit each call", async () => {
    const client = await mcp(a.ctx);
    const list = body(await client.callTool({ name: "list_contacts", arguments: { q: "ana.casa" } }));
    expect(list.items.map((c: { id: string }) => c.id)).toEqual([ids.ana]);

    const detail = body(await client.callTool({ name: "get_contact", arguments: { contactId: ids.ana } }));
    expect(detail.identities[0].externalId).toBe(`ig-ana-${suffix}`);

    const hist = body(await client.callTool({ name: "list_contact_history", arguments: { contactId: ids.ana } }));
    expect(hist.items).toHaveLength(2);
    expect(JSON.stringify(hist)).not.toMatch(/Hola quiero|commentText/);

    const cross = await client.callTool({ name: "get_contact", arguments: { contactId: ids.other } });
    expect(cross.isError).toBe(true);
    expect(body(cross).error.code).toBe("NOT_FOUND");
    const crossHist = await client.callTool({ name: "list_contact_history", arguments: { contactId: ids.other } });
    expect(crossHist.isError).toBe(true);

    const audits = await prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: { startsWith: "mcp.list_contact" } } });
    expect(audits).toBeGreaterThanOrEqual(2);
  });

  it("MCP hides the contact tools from a token without contacts:read", async () => {
    const readOnly = { ...a.ctx, scopes: ["read"] };
    const client = await mcp(readOnly);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => n.includes("contact"))).toBe(false);
    const res = await client.callTool({ name: "list_contacts", arguments: {} });
    expect(res.isError).toBe(true);
  });
});
