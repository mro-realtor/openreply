/**
 * Real disposable Postgres, fake Meta. Skipped unless RUN_DB_TESTS=1.
 * Nothing here contacts Meta or any live account.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { maintainInstagramAccounts, type MetaOps } from "@/lib/instagram/maintenance";
import { PermissionError, RateLimitError, TokenExpiredError } from "@/lib/meta/client";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const suffix = randomBytes(4).toString("hex");
const DAY = 86_400_000;
const now = new Date("2026-10-20T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * DAY);
const enc = (p: string) => `enc:${p}`;
const dec = (s: string) => {
  if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
  return s.slice(4);
};
const BOTH = ["comments", "messages"];
const SCOPES = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"];

interface Fake extends MetaOps {
  refreshed: string[];
  subscribed: string[];
}

function fakeOps(opts: {
  refresh?: (token: string) => Promise<{ accessToken: string; expiresIn: number }>;
  fields?: (igId: string) => string[];
  onSubscribe?: (igId: string) => void;
} = {}): Fake {
  const fake: Fake = {
    refreshed: [],
    subscribed: [],
    async refreshToken(token) {
      fake.refreshed.push(token);
      return opts.refresh ? opts.refresh(token) : { accessToken: `${token}-new`, expiresIn: 60 * 86_400 };
    },
    async getSubscribedFields(igId) {
      return opts.fields ? opts.fields(igId) : BOTH;
    },
    async subscribe(igId) {
      fake.subscribed.push(igId);
      opts.onSubscribe?.(igId);
      return { success: true };
    },
  };
  return fake;
}

async function makeWorkspace(label: string) {
  const user = await prisma.user.create({ data: { email: `${label}-${suffix}@example.test` } });
  const ws = await prisma.workspace.create({
    data: { name: `${label}-${suffix}`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
  });
  return { ws, user };
}

let n = 0;
async function makeAccount(workspaceId: string, name: string, over: Record<string, unknown> = {}) {
  n++;
  return prisma.instagramAccount.create({
    data: {
      workspaceId,
      instagramId: `ig-${suffix}-${n}`,
      username: `${name}.${suffix}`,
      accessToken: enc(`token-${name}-${suffix}`),
      tokenExpiresAt: days(10),
      connectedAt: days(-50),
      grantedScopes: SCOPES,
      ...over,
    },
  });
}

const run1 = (ws: string, ops: MetaOps, extra: { now?: Date; sleep?: (ms: number) => Promise<void>; inRunAttempts?: number } = {}) =>
  maintainInstagramAccounts(prisma, ops, { now, decrypt: dec, encrypt: enc, sleep: async () => {}, workspaceId: ws, ...extra });

const get = (id: string) => prisma.instagramAccount.findUniqueOrThrow({ where: { id } });
const events = (ws: string) => prisma.operationalEvent.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" } });

run("instagram connection maintenance (database, fake Meta)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("renews each account with its own token across owners, and skips accounts that are not due", async () => {
    const { ws } = await makeWorkspace("multi");
    const mine1 = await makeAccount(ws.id, "mine1", { connectedByUserId: "me" });
    const mine2 = await makeAccount(ws.id, "mine2", { connectedByUserId: "me", tokenExpiresAt: days(45) });
    const nancy = await makeAccount(ws.id, "nancy", { connectedByUserId: "nancy" });

    const ops = fakeOps();
    const out = await run1(ws.id, ops);

    expect(ops.refreshed.sort()).toEqual([`token-mine1-${suffix}`, `token-nancy-${suffix}`].sort());
    expect(out.find((o) => o.accountId === mine2.id)?.refresh).toBe("skipped");

    const a = await get(mine1.id);
    expect(dec(a.accessToken)).toBe(`token-mine1-${suffix}-new`);
    expect(a.tokenExpiresAt?.getTime()).toBe(now.getTime() + 60 * DAY);
    expect(a.nextRefreshAt?.getTime()).toBe(now.getTime() + 39 * DAY);
    expect(a.lastRefreshAt?.getTime()).toBe(now.getTime());
    expect(a.connectionStatus).toBe("ACTIVE");
    expect(dec((await get(nancy.id)).accessToken)).toBe(`token-nancy-${suffix}-new`);
    expect(dec((await get(mine2.id)).accessToken)).toBe(`token-mine2-${suffix}`);
    expect((await get(nancy.id)).connectedByUserId).toBe("nancy");
  });

  it("marks only the revoked account as needing a reconnect and keeps the others running", async () => {
    const { ws } = await makeWorkspace("revoked");
    const ok = await makeAccount(ws.id, "ok");
    const revoked = await makeAccount(ws.id, "revoked");
    const ops = fakeOps({
      refresh: async (token) => {
        if (token.includes("revoked")) throw new TokenExpiredError("Error validating access token: session invalidated");
        return { accessToken: `${token}-new`, expiresIn: 60 * 86_400 };
      },
    });
    await run1(ws.id, ops);

    expect((await get(ok.id)).connectionStatus).toBe("ACTIVE");
    const r = await get(revoked.id);
    expect(r.connectionStatus).toBe("NEEDS_RECONNECT");
    expect(r.needsReconnectReason).toContain("Reconnect");
    const ev = await events(ws.id);
    expect(ev.filter((e) => e.level === "ERROR")).toHaveLength(1);

    // A later run does not retry or re-alert an account waiting for its owner.
    const again = fakeOps();
    await run1(ws.id, again, { now: new Date(now.getTime() + DAY) });
    expect(again.refreshed.every((t) => !t.includes("revoked"))).toBe(true);
    expect((await events(ws.id)).filter((e) => e.level === "ERROR")).toHaveLength(1);
  });

  it("treats removed permissions as needing a reconnect", async () => {
    const { ws } = await makeWorkspace("perm");
    const acct = await makeAccount(ws.id, "perm");
    await run1(ws.id, fakeOps({ refresh: async () => { throw new PermissionError("permission removed"); } }));
    const a = await get(acct.id);
    expect(a.connectionStatus).toBe("NEEDS_RECONNECT");
    expect(a.needsReconnectReason).toContain("permissions");
  });

  it("flags an already expired token without calling Meta", async () => {
    const { ws } = await makeWorkspace("expired");
    const acct = await makeAccount(ws.id, "expired", { tokenExpiresAt: days(-2) });
    const ops = fakeOps();
    const out = await run1(ws.id, ops);
    expect(ops.refreshed).toHaveLength(0);
    expect(out[0].refresh).toBe("expired");
    expect((await get(acct.id)).connectionStatus).toBe("NEEDS_RECONNECT");
  });

  it("retries transient failures, backs off, degrades after repeated failures, then recovers", async () => {
    const { ws } = await makeWorkspace("transient");
    const acct = await makeAccount(ws.id, "flaky");
    const sleeps: number[] = [];
    let calls = 0;
    const failing = fakeOps({ refresh: async () => { calls++; throw new RateLimitError("rate limited"); } });

    for (let day = 0; day < 3; day++) {
      const at = new Date(now.getTime() + day * 25 * 3_600_000);
      await run1(ws.id, failing, { now: at, sleep: async (ms) => { sleeps.push(ms); } });
      // Move the retry time into the past so each simulated day is due again.
      await prisma.instagramAccount.update({ where: { id: acct.id }, data: { nextRefreshAt: new Date(at.getTime() - 1000) } });
    }
    expect(calls).toBe(9); // 3 in-run tries on each of 3 runs
    expect(sleeps.slice(0, 2)).toEqual([1000, 3000]);
    const degraded = await get(acct.id);
    expect(degraded.connectionStatus).toBe("DEGRADED");
    expect(degraded.refreshAttempts).toBe(3);
    expect((await events(ws.id)).filter((e) => e.level === "ERROR")).toHaveLength(1);

    const healthy = fakeOps();
    await run1(ws.id, healthy, { now: new Date(now.getTime() + 4 * DAY) });
    const recovered = await get(acct.id);
    expect(recovered.connectionStatus).toBe("ACTIVE");
    expect(recovered.refreshAttempts).toBe(0);
    expect(recovered.lastRefreshError).toBeNull();
    expect((await events(ws.id)).some((e) => e.level === "INFO" && e.message.includes("connected again"))).toBe(true);
  });

  it("schedules the retry with backoff after one transient failure", async () => {
    const { ws } = await makeWorkspace("backoff");
    const acct = await makeAccount(ws.id, "backoff");
    await run1(ws.id, fakeOps({ refresh: async () => { throw new TypeError("fetch failed"); } }), { inRunAttempts: 1 });
    const a = await get(acct.id);
    expect(a.refreshAttempts).toBe(1);
    expect(a.connectionStatus).toBe("ACTIVE");
    expect(a.nextRefreshAt?.getTime()).toBe(now.getTime() + 3_600_000);
  });

  it("restores a missing webhook subscription", async () => {
    const { ws } = await makeWorkspace("hook");
    const acct = await makeAccount(ws.id, "hook", { tokenExpiresAt: days(50), webhookSubscribed: false });
    let restored = false;
    const ops = fakeOps({ fields: () => (restored ? BOTH : []), onSubscribe: () => { restored = true; } });
    const out = await run1(ws.id, ops);
    expect(out[0].webhook).toBe("restored");
    expect(ops.subscribed).toEqual([acct.instagramId]);
    const a = await get(acct.id);
    expect(a.webhookSubscribed).toBe(true);
    expect(a.webhookError).toBeNull();
    expect(a.webhookCheckedAt?.getTime()).toBe(now.getTime());
  });

  it("alerts when a webhook subscription cannot be restored", async () => {
    const { ws } = await makeWorkspace("hookfail");
    const acct = await makeAccount(ws.id, "hookfail", { tokenExpiresAt: days(50) });
    const out = await run1(ws.id, fakeOps({ fields: () => ["comments"] }));
    expect(out[0].webhook).toBe("failed");
    const a = await get(acct.id);
    expect(a.webhookSubscribed).toBe(false);
    expect(a.webhookError).toContain("messages");
    expect((await events(ws.id)).filter((e) => e.level === "ERROR")).toHaveLength(1);
  });

  it("does not send the same alert twice within 24 hours", async () => {
    const { ws } = await makeWorkspace("dedupe");
    await makeAccount(ws.id, "dedupe", { tokenExpiresAt: days(50) });
    const ops = fakeOps({ fields: () => [] });
    await run1(ws.id, ops);
    await run1(ws.id, ops, { now: new Date(now.getTime() + 3_600_000) });
    expect((await events(ws.id)).filter((e) => e.level === "ERROR")).toHaveLength(1);
    await run1(ws.id, ops, { now: new Date(now.getTime() + 26 * 3_600_000) });
    expect((await events(ws.id)).filter((e) => e.level === "ERROR")).toHaveLength(2);
  });

  it("does not refresh an account that another run has locked, and overlapping runs refresh once", async () => {
    const { ws } = await makeWorkspace("lock");
    const locked = await makeAccount(ws.id, "locked", { refreshLockedUntil: days(0.01) });
    const free = await makeAccount(ws.id, "free");
    const ops = fakeOps();
    await Promise.all([run1(ws.id, ops), run1(ws.id, ops)]);
    expect(ops.refreshed.filter((t) => t.includes("free"))).toHaveLength(1);
    expect(ops.refreshed.some((t) => t.includes("locked"))).toBe(false);
    expect((await get(free.id)).refreshLockedUntil).toBeNull();
    expect((await get(locked.id)).refreshLockedUntil).not.toBeNull();
  });

  it("flags an account whose granted permissions are incomplete", async () => {
    const { ws } = await makeWorkspace("scopes");
    const acct = await makeAccount(ws.id, "scopes", { tokenExpiresAt: days(50), grantedScopes: ["instagram_business_basic"] });
    await run1(ws.id, fakeOps());
    const a = await get(acct.id);
    expect(a.connectionStatus).toBe("DEGRADED");
    expect(a.lastRefreshError).toContain("Missing permissions");
  });

  it("marks an unreadable stored credential as needing a reconnect", async () => {
    const { ws } = await makeWorkspace("garbled");
    const acct = await makeAccount(ws.id, "garbled", { accessToken: "not-encrypted-by-us" });
    await run1(ws.id, fakeOps());
    expect((await get(acct.id)).connectionStatus).toBe("NEEDS_RECONNECT");
  });

  it("never writes credentials into alerts or stored errors", async () => {
    const { ws } = await makeWorkspace("secrets");
    const acct = await makeAccount(ws.id, "secrets");
    const secret = "IGAA" + "z".repeat(100);
    await run1(ws.id, fakeOps({ refresh: async () => { throw new TokenExpiredError(`bad token access_token=${secret}`); } }));
    const a = await get(acct.id);
    const blob = JSON.stringify([a.lastRefreshError, a.needsReconnectReason, await events(ws.id)]);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain(a.accessToken);
  });
});
