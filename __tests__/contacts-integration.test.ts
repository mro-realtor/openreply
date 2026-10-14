/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1.
 * Covers contact resolution, per-person DM decisions and the DmLog backfill.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { backfillContactsFromDmLog } from "@/lib/contacts/backfill";
import { decideDm, linkDmLog, recordDmSent, resolveContact, setHumanTakeover, setOptOut } from "@/lib/contacts/service";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const suffix = randomBytes(4).toString("hex");

interface Tenant { workspaceId: string; accountId: string; autoA: string; autoB: string }

async function makeTenant(label: string): Promise<Tenant> {
  const user = await prisma.user.create({ data: { email: `${label}-${suffix}@example.test` } });
  const ws = await prisma.workspace.create({
    data: { name: `${label}-${suffix}`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
  });
  const acct = await prisma.instagramAccount.create({
    data: { workspaceId: ws.id, instagramId: `ig-${label}-${suffix}`, username: `${label}.${suffix}`, accessToken: "enc" },
  });
  const mk = (name: string) =>
    prisma.automation.create({
      data: { name, dmMessage: "hi", workspaceId: ws.id, instagramAccountId: acct.id, isActive: false, isDraft: true },
    });
  const [a, b] = [await mk("A"), await mk("B")];
  return { workspaceId: ws.id, accountId: acct.id, autoA: a.id, autoB: b.id };
}

let seq = 0;
async function log(t: Tenant, automationId: string, commenterId: string, status: "SENT" | "PENDING", sentAt?: Date) {
  seq++;
  return prisma.dmLog.create({
    data: {
      workspaceId: t.workspaceId, automationId, instagramAccountId: t.accountId, commenterId,
      commenterName: `name-${commenterId}`, commentText: "info", commentId: `c-${suffix}-${seq}`,
      status, dmSentAt: sentAt ?? null,
    },
  });
}

run("contacts (database)", () => {
  let one: Tenant;
  let two: Tenant;
  beforeAll(async () => {
    one = await makeTenant("one");
    two = await makeTenant("two");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves the same person to one contact, even under concurrent calls", async () => {
    const input = { workspaceId: one.workspaceId, platform: "INSTAGRAM" as const, externalId: "p1" };
    const results = await Promise.all(Array.from({ length: 8 }, () => resolveContact(prisma, input)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await prisma.contact.count({ where: { workspaceId: one.workspaceId, identities: { some: { externalId: "p1" } } } })).toBe(1);
  });

  it("keeps the same external id in two workspaces as two different people", async () => {
    const a = await resolveContact(prisma, { workspaceId: one.workspaceId, platform: "INSTAGRAM", externalId: "shared" });
    const b = await resolveContact(prisma, { workspaceId: two.workspaceId, platform: "INSTAGRAM", externalId: "shared" });
    expect(a.id).not.toBe(b.id);
  });

  it("blocks a second DM from the same campaign but allows another campaign", async () => {
    const c = await resolveContact(prisma, { workspaceId: one.workspaceId, platform: "INSTAGRAM", externalId: "p2" });
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoA, cooldownHours: 0 })).toEqual({ allow: true });
    const l = await log(one, one.autoA, "p2", "SENT", new Date());
    await linkDmLog(prisma, { automationId: l.automationId, commentId: l.commentId, contactId: c.id });
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoA, cooldownHours: 0 })).toEqual({
      allow: false, reason: "ALREADY_SENT_THIS_CAMPAIGN",
    });
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoB, cooldownHours: 0 })).toEqual({ allow: true });
  });

  it("applies the cross-campaign cooldown only inside the window", async () => {
    const c = await resolveContact(prisma, { workspaceId: one.workspaceId, platform: "INSTAGRAM", externalId: "p3" });
    const t0 = new Date("2026-10-15T12:00:00Z");
    await recordDmSent(prisma, c.id, t0);
    const within = new Date(t0.getTime() + 3_600_000);
    const after = new Date(t0.getTime() + 25 * 3_600_000);
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoB, cooldownHours: 24, now: within })).toEqual({ allow: false, reason: "COOLDOWN" });
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoB, cooldownHours: 24, now: after })).toEqual({ allow: true });
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoB, cooldownHours: 0, now: within })).toEqual({ allow: true });
  });

  it("opt-out and human takeover always win, and are reversible", async () => {
    const c = await resolveContact(prisma, { workspaceId: one.workspaceId, platform: "INSTAGRAM", externalId: "p4" });
    expect(await setOptOut(prisma, one.workspaceId, c.id, true)).toBe(true);
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoA, cooldownHours: 0 })).toEqual({ allow: false, reason: "OPTED_OUT" });
    await setOptOut(prisma, one.workspaceId, c.id, false);
    await setHumanTakeover(prisma, one.workspaceId, c.id, true);
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoA, cooldownHours: 0 })).toEqual({ allow: false, reason: "HUMAN_TAKEOVER" });
    await setHumanTakeover(prisma, one.workspaceId, c.id, false);
    expect(await decideDm(prisma, { contactId: c.id, automationId: one.autoA, cooldownHours: 0 })).toEqual({ allow: true });
  });

  it("will not change another workspace's contact", async () => {
    const c = await resolveContact(prisma, { workspaceId: two.workspaceId, platform: "INSTAGRAM", externalId: "p5" });
    expect(await setOptOut(prisma, one.workspaceId, c.id, true)).toBe(false);
    expect((await prisma.contact.findUnique({ where: { id: c.id } }))?.status).toBe("ACTIVE");
  });

  it("backfill: dry run changes nothing, apply links history, second apply is a no-op", async () => {
    const t = await makeTenant("fill");
    const sentAt = new Date("2026-09-01T10:00:00Z");
    await log(t, t.autoA, "u1", "SENT", sentAt);
    await log(t, t.autoB, "u1", "PENDING");
    await log(t, t.autoA, "u2", "PENDING");

    const dry = await backfillContactsFromDmLog(prisma, { workspaceId: t.workspaceId });
    expect(dry).toMatchObject({ dryRun: true, identitiesToCreate: 2, contactsCreated: 0, logsLinked: 0 });
    expect(await prisma.contact.count({ where: { workspaceId: t.workspaceId } })).toBe(0);

    const applied = await backfillContactsFromDmLog(prisma, { workspaceId: t.workspaceId, dryRun: false });
    expect(applied).toMatchObject({ contactsCreated: 2, logsLinked: 3 });
    const u1 = await prisma.socialIdentity.findFirst({ where: { workspaceId: t.workspaceId, externalId: "u1" }, include: { contact: true } });
    expect(u1?.contact.lastDmSentAt?.toISOString()).toBe(sentAt.toISOString());
    expect(await prisma.dmLog.count({ where: { workspaceId: t.workspaceId, contactId: null } })).toBe(0);

    const again = await backfillContactsFromDmLog(prisma, { workspaceId: t.workspaceId, dryRun: false });
    expect(again).toMatchObject({ contactsCreated: 0, logsLinked: 0 });
    expect(await prisma.dmLog.count({ where: { workspaceId: t.workspaceId, status: "SENT" } })).toBe(1);
  });
});
