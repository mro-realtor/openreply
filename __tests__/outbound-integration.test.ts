/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1.
 * No real network is used: the sender is a fake that records what it was given.
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveContact, setHumanTakeover, setOptOut } from "@/lib/contacts/service";
import { deliverDue, type SendRequest, type Sender } from "@/lib/outbound/deliver";
import { createEndpoint, replayDelivery, updateEndpoint } from "@/lib/outbound/endpoints";
import { emitDmEventsForComment, emitEvent } from "@/lib/outbound/events";
import { verifySignature } from "@/lib/outbound/signing";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const suffix = randomBytes(4).toString("hex");
const encrypt = (s: string) => `enc:${s}`;
const decrypt = (s: string) => s.slice(4);

interface Tenant { userId: string; workspaceId: string; accountId: string; automations: string[] }
const created: Tenant[] = [];
let seq = 0;

async function tenant(label: string): Promise<Tenant> {
  const user = await prisma.user.create({ data: { email: `${label}-${suffix}-${++seq}@example.test` } });
  const ws = await prisma.workspace.create({
    data: { name: `${label}-${suffix}`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
  });
  const acct = await prisma.instagramAccount.create({
    data: { workspaceId: ws.id, instagramId: `ig-${label}-${suffix}-${seq}`, username: `${label}.${suffix}.${seq}`, accessToken: "enc" },
  });
  const automations: string[] = [];
  for (const n of ["A", "B", "C"]) {
    const a = await prisma.automation.create({
      data: { name: n, dmMessage: "hi", workspaceId: ws.id, instagramAccountId: acct.id, isActive: false, isDraft: true },
    });
    automations.push(a.id);
  }
  const t = { userId: user.id, workspaceId: ws.id, accountId: acct.id, automations };
  created.push(t);
  return t;
}

async function endpoint(t: Tenant, eventTypes: string[] = []) {
  const res = await createEndpoint(prisma, {
    workspaceId: t.workspaceId,
    name: `ep-${++seq}`,
    url: `https://93.184.216.34/hook/${suffix}-${seq}`,
    eventTypes,
    encrypt,
  });
  if (!res.ok) throw new Error(res.error);
  return { id: res.value.endpoint.id, secret: res.value.secret, url: `https://93.184.216.34/hook/${suffix}-${seq}` };
}

async function withFlag<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.OUTBOUND_WEBHOOKS_ENABLED;
  process.env.OUTBOUND_WEBHOOKS_ENABLED = "true";
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.OUTBOUND_WEBHOOKS_ENABLED;
    else process.env.OUTBOUND_WEBHOOKS_ENABLED = before;
  }
}

const soon = () => new Date(Date.now() + 5_000);
const ok: Sender = async () => ({ status: 204 });
const status = (code: number): Sender => async () => ({ status: code });

afterEach(async () => {
  const ids = created.splice(0).map((t) => t.userId);
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

run("outbound webhooks (database)", () => {
  it("queues a delivery only for active endpoints in the same workspace that listen for the event", async () => {
    const a = await tenant("a");
    const b = await tenant("b");
    const all = await endpoint(a);
    const wants = await endpoint(a, ["dm.sent"]);
    const other = await endpoint(a, ["dm.failed"]);
    const off = await endpoint(a);
    await prisma.webhookEndpoint.update({ where: { id: off.id }, data: { isActive: false } });
    const foreign = await endpoint(b);

    const res = await emitEvent(prisma, { workspaceId: a.workspaceId, type: "dm.sent", dedupeKey: "k1", data: { n: 1 } });
    expect(res).toEqual({ created: true, deliveries: 2 });

    const rows = await prisma.webhookDelivery.findMany({
      where: { endpointId: { in: [all.id, wants.id, other.id, off.id, foreign.id] } },
      select: { endpointId: true },
    });
    expect(rows.map((r) => r.endpointId).sort()).toEqual([all.id, wants.id].sort());

    // the same key again does nothing
    expect(await emitEvent(prisma, { workspaceId: a.workspaceId, type: "dm.sent", dedupeKey: "k1", data: { n: 1 } })).toEqual({ created: false, deliveries: 0 });
    expect(await prisma.webhookDelivery.count({ where: { endpointId: { in: [all.id, wants.id] } } })).toBe(2);

    // an endpoint with no event list does not receive ping
    expect(await emitEvent(prisma, { workspaceId: a.workspaceId, type: "ping", dedupeKey: "p1", data: {} })).toEqual({ created: true, deliveries: 0 });
  });

  it("sends a signed request that a receiver can verify, then marks it delivered", async () => {
    const t = await tenant("send");
    const ep = await endpoint(t);
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "s1", data: { n: 1 } });

    const calls: SendRequest[] = [];
    const now = soon();
    const summary = await deliverDue(prisma, async (r) => { calls.push(r); return { status: 204 }; }, { decrypt, now });
    expect(summary.delivered).toBe(1);
    expect(calls).toHaveLength(1);

    const c = calls[0];
    expect(c.url).toBe(ep.url);
    expect(verifySignature({ secret: ep.secret, header: c.headers["X-OpenReply-Signature"], body: c.body, nowMs: now.getTime() })).toBe(true);
    expect(verifySignature({ secret: ep.secret, header: c.headers["X-OpenReply-Signature"], body: c.body + "x", nowMs: now.getTime() })).toBe(false);
    const parsed = JSON.parse(c.body);
    expect(parsed).toMatchObject({ type: "dm.sent", workspaceId: t.workspaceId, data: { n: 1 } });
    expect(c.headers["X-OpenReply-Event-Id"]).toBe(parsed.id);
    expect(c.headers["X-OpenReply-Event"]).toBe("dm.sent");

    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id } });
    expect(d).toMatchObject({ status: "DELIVERED", attempts: 1, lastError: null });
    expect(d.lockedUntil).toBeNull();
    const e = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } });
    expect(e.lastSuccessAt).not.toBeNull();
    expect(e.consecutiveFailures).toBe(0);
  });

  it("retries a failing receiver with backoff and gives up after eight tries", async () => {
    const t = await tenant("retry");
    const ep = await endpoint(t);
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.failed", dedupeKey: "r1", data: {} });
    const get = () => prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id } });

    let now = soon();
    expect((await deliverDue(prisma, status(500), { decrypt, now })).retrying).toBe(1);
    let d = await get();
    expect(d).toMatchObject({ status: "FAILED", attempts: 1, lastStatusCode: 500 });
    expect(d.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);

    // not due yet
    expect((await deliverDue(prisma, status(500), { decrypt, now: new Date(now.getTime() + 30_000) })).attempted).toBe(0);

    for (let i = 2; i <= 8; i++) {
      now = new Date(now.getTime() + 25 * 3_600_000);
      await deliverDue(prisma, status(500), { decrypt, now });
    }
    d = await get();
    expect(d).toMatchObject({ status: "DEAD", attempts: 8 });
    expect((await deliverDue(prisma, status(500), { decrypt, now: new Date(now.getTime() + 25 * 3_600_000) })).attempted).toBe(0);
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } })).consecutiveFailures).toBe(8);
  });

  it("records a network error without a status code", async () => {
    const t = await tenant("net");
    const ep = await endpoint(t);
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "n1", data: {} });
    await deliverDue(prisma, async () => { throw new Error("connect ECONNREFUSED"); }, { decrypt, now: soon() });
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id } });
    expect(d).toMatchObject({ status: "FAILED", lastStatusCode: null, attempts: 1 });
    expect(d.lastError).toContain("ECONNREFUSED");
  });

  it("switches an endpoint off when the receiver answers 410 Gone", async () => {
    const t = await tenant("gone");
    const ep = await endpoint(t);
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "g1", data: {} });
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "g2", data: {} });
    await deliverDue(prisma, status(410), { decrypt, now: soon(), limit: 1 });
    const e = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } });
    expect(e.isActive).toBe(false);
    expect(e.disabledReason).toContain("410");
    // the second queued delivery is not sent to a switched-off endpoint
    let sent = 0;
    await deliverDue(prisma, async () => { sent++; return { status: 200 }; }, { decrypt, now: soon() });
    expect(sent).toBe(0);
  });

  it("switches an endpoint off after too many failures in a row and records an alert", async () => {
    const t = await tenant("auto");
    const ep = await endpoint(t);
    await prisma.webhookEndpoint.update({ where: { id: ep.id }, data: { consecutiveFailures: 19 } });
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "a1", data: {} });
    await deliverDue(prisma, status(500), { decrypt, now: soon() });
    const e = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } });
    expect(e.isActive).toBe(false);
    expect(e.disabledReason).toContain("20");
    const alert = await prisma.operationalEvent.findFirst({ where: { workspaceId: t.workspaceId, level: "WARNING" } });
    expect(alert?.message).toContain("switched off");
    expect(JSON.stringify(alert?.payload)).not.toContain("93.184.216.34");
  });

  it("does not send the same delivery twice when two workers run at once", async () => {
    const t = await tenant("race");
    await endpoint(t);
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "c1", data: {} });
    let sent = 0;
    const slow: Sender = async () => { sent++; await new Promise((r) => setTimeout(r, 150)); return { status: 200 }; };
    const now = soon();
    await Promise.all([deliverDue(prisma, slow, { decrypt, now }), deliverDue(prisma, slow, { decrypt, now })]);
    expect(sent).toBe(1);
  });

  it("holds deliveries for a switched-off endpoint and resumes when it is switched back on", async () => {
    const t = await tenant("hold");
    const other = await tenant("hold2");
    const ep = await endpoint(t);
    await updateEndpoint(prisma, { workspaceId: t.workspaceId, id: ep.id, patch: { isActive: false }, encrypt });
    await prisma.webhookEndpoint.update({ where: { id: ep.id }, data: { isActive: true } });
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "h1", data: {} });
    await updateEndpoint(prisma, { workspaceId: t.workspaceId, id: ep.id, patch: { isActive: false }, encrypt });

    let sent = 0;
    const counting: Sender = async () => { sent++; return { status: 200 }; };
    await deliverDue(prisma, counting, { decrypt, now: soon() });
    expect(sent).toBe(0);

    // a different workspace cannot touch it
    const denied = await updateEndpoint(prisma, { workspaceId: other.workspaceId, id: ep.id, patch: { isActive: true }, encrypt });
    expect(denied).toMatchObject({ ok: false, status: 404 });

    await updateEndpoint(prisma, { workspaceId: t.workspaceId, id: ep.id, patch: { isActive: true }, encrypt });
    await deliverDue(prisma, counting, { decrypt, now: soon() });
    expect(sent).toBe(1);
  });

  it("lets a person replay a dead delivery, only inside their own workspace", async () => {
    const t = await tenant("replay");
    const other = await tenant("replay2");
    const ep = await endpoint(t);
    await emitEvent(prisma, { workspaceId: t.workspaceId, type: "dm.sent", dedupeKey: "p1", data: {} });
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id } });
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "DEAD", attempts: 8, lastError: "x" } });

    expect(await replayDelivery(prisma, other.workspaceId, d.id)).toBe(false);
    expect(await replayDelivery(prisma, t.workspaceId, d.id)).toBe(true);
    const after = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(after).toMatchObject({ status: "PENDING", attempts: 0, lastError: null });
    expect((await deliverDue(prisma, ok, { decrypt, now: soon() })).delivered).toBe(1);
  });

  it("validates endpoints and never returns the secret or the URL path again", async () => {
    const t = await tenant("create");
    const bad = async (url: string, eventTypes?: unknown) =>
      createEndpoint(prisma, { workspaceId: t.workspaceId, name: "x", url, eventTypes, encrypt });
    for (const url of ["http://93.184.216.34/x", "https://localhost/x", "https://10.0.0.5/x", "https://169.254.169.254/x", "https://u:p@93.184.216.34/x", "nope"]) {
      expect((await bad(url)).ok).toBe(false);
    }
    expect((await bad("https://93.184.216.34/x", ["dm.nope"])).ok).toBe(false);
    expect((await createEndpoint(prisma, { workspaceId: t.workspaceId, name: "  ", url: "https://93.184.216.34/x", encrypt })).ok).toBe(false);

    const res = await createEndpoint(prisma, { workspaceId: t.workspaceId, name: "n8n", url: "https://93.184.216.34/webhook/very-secret-path", eventTypes: ["dm.sent"], encrypt });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.secret.startsWith("whsec_")).toBe(true);
    const json = JSON.stringify(res.value.endpoint);
    expect(json).not.toContain("very-secret-path");
    expect(json).not.toContain("secretEncrypted");
    expect(res.value.endpoint.urlPreview).toBe("https://93.184.216.34/...");

    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: res.value.endpoint.id } });
    expect(stored.secretEncrypted).not.toBe(res.value.secret);
    expect(decrypt(stored.secretEncrypted)).toBe(res.value.secret);

    const rotated = await updateEndpoint(prisma, { workspaceId: t.workspaceId, id: stored.id, patch: { rotateSecret: true }, encrypt });
    expect(rotated.ok && rotated.value.secret).toBeTruthy();
    const after = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: stored.id } });
    expect(decrypt(after.secretEncrypted)).not.toBe(res.value.secret);
  });

  it("announces DM outcomes once each, and only when the feature is on", async () => {
    const t = await tenant("dm");
    const ep = await endpoint(t);
    const mk = (automationId: string, commentId: string, status: "SENT" | "SKIPPED_DEDUP" | "PENDING", errorMessage?: string) =>
      prisma.dmLog.create({
        data: {
          workspaceId: t.workspaceId, automationId, instagramAccountId: t.accountId, commenterId: "c1", commenterName: "Pat",
          commentText: "info please", commentId, status, errorMessage: errorMessage ?? null, dmSentAt: status === "SENT" ? new Date() : null,
        },
      });
    const cid = `cm-${suffix}-${seq}`;
    await mk(t.automations[0], cid, "SENT");
    await mk(t.automations[1], cid, "SKIPPED_DEDUP", "ALREADY_SENT_THIS_CAMPAIGN");
    await mk(t.automations[2], cid, "PENDING");

    await emitDmEventsForComment(prisma, cid); // flag off
    expect(await prisma.outboxEvent.count({ where: { workspaceId: t.workspaceId } })).toBe(0);

    await withFlag(async () => {
      await emitDmEventsForComment(prisma, cid);
      await emitDmEventsForComment(prisma, cid);
    });
    const events = await prisma.outboxEvent.findMany({ where: { workspaceId: t.workspaceId }, orderBy: { type: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["dm.sent", "dm.skipped"]);
    expect(events[0].payload).toMatchObject({ status: "SENT", commenterId: "c1", reason: null });
    expect(events[1].payload).toMatchObject({ status: "SKIPPED_DEDUP", reason: "ALREADY_SENT_THIS_CAMPAIGN" });
    expect(await prisma.webhookDelivery.count({ where: { endpointId: ep.id } })).toBe(2);
  });

  it("announces opt-outs and human takeovers, and nothing when the feature is off", async () => {
    const t = await tenant("contact");
    await endpoint(t);
    const person = await resolveContact(prisma, { workspaceId: t.workspaceId, platform: "INSTAGRAM", externalId: `u-${suffix}-${seq}`, handle: "pat" });

    await setOptOut(prisma, t.workspaceId, person.id, true); // flag off
    expect(await prisma.outboxEvent.count({ where: { workspaceId: t.workspaceId } })).toBe(0);

    await withFlag(async () => {
      await setOptOut(prisma, t.workspaceId, person.id, false); // opting back in is not announced
      await setOptOut(prisma, t.workspaceId, person.id, true);
      await setHumanTakeover(prisma, t.workspaceId, person.id, true);
    });
    const events = await prisma.outboxEvent.findMany({ where: { workspaceId: t.workspaceId }, orderBy: { type: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["contact.human_takeover", "contact.opted_out"]);
    expect(events[0].payload).toEqual({ contactId: person.id });
  });
});
