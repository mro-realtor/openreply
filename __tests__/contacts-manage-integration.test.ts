/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1.
 * Covers consent history, lead assignment between teammates, listing and filtering.
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { assignContact, getContact, listContacts, recordConsent } from "@/lib/contacts/manage";
import { decideDm, resolveContact } from "@/lib/contacts/service";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const suffix = randomBytes(4).toString("hex");

interface Team { workspaceId: string; ownerId: string; nancyId: string; outsiderId: string; automationId: string }
const userIds: string[] = [];
let seq = 0;

async function team(label: string): Promise<Team> {
  const mk = async (who: string) => {
    const u = await prisma.user.create({ data: { email: `${label}-${who}-${suffix}-${++seq}@example.test` } });
    userIds.push(u.id);
    return u.id;
  };
  const ownerId = await mk("owner");
  const nancyId = await mk("nancy");
  const outsiderId = await mk("outsider");
  const ws = await prisma.workspace.create({
    data: {
      name: `${label}-${suffix}`,
      ownerId,
      members: { create: [{ userId: ownerId, role: "OWNER" }, { userId: nancyId, role: "MEMBER" }] },
    },
  });
  const acct = await prisma.instagramAccount.create({
    data: { workspaceId: ws.id, instagramId: `ig-${label}-${suffix}-${seq}`, username: `${label}.${suffix}.${seq}`, accessToken: "enc" },
  });
  const auto = await prisma.automation.create({
    data: { name: "A", dmMessage: "hi", workspaceId: ws.id, instagramAccountId: acct.id, isActive: false, isDraft: true },
  });
  return { workspaceId: ws.id, ownerId, nancyId, outsiderId, automationId: auto.id };
}

async function person(t: Team, handle: string, displayName?: string) {
  return resolveContact(prisma, { workspaceId: t.workspaceId, platform: "INSTAGRAM", externalId: `x-${handle}-${suffix}-${++seq}`, handle, displayName: displayName ?? handle });
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

afterEach(async () => {
  const ids = userIds.splice(0);
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

run("contact consent and assignment (database)", () => {
  it("records consent with its source and keeps a history", async () => {
    const t = await team("consent");
    const c = await person(t, "pat");
    expect((await getContact(prisma, t.workspaceId, c.id)) as { ok: boolean }).toMatchObject({ ok: true });

    const res = await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "GRANTED", source: "dm_reply", note: "Replied YES to the text offer", recordedByUserId: t.ownerId });
    expect(res).toEqual({ ok: true, value: { consentStatus: "GRANTED", optedOut: false } });

    const row = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ consentStatus: "GRANTED", consentSource: "dm_reply", status: "ACTIVE" });
    expect(row.consentUpdatedAt).not.toBeNull();

    const detail = await getContact(prisma, t.workspaceId, c.id);
    if (!detail.ok) throw new Error("expected contact");
    expect(detail.value.consent).toMatchObject({ status: "GRANTED", source: "dm_reply" });
    expect(detail.value.consentHistory).toHaveLength(1);
    expect(detail.value.consentHistory[0]).toMatchObject({ source: "dm_reply", note: "Replied YES to the text offer", recordedByUserId: t.ownerId });
  });

  it("rejects bad consent input and contacts from another workspace", async () => {
    const t = await team("badconsent");
    const other = await team("badconsent2");
    const c = await person(t, "pat");
    const input = { workspaceId: t.workspaceId, contactId: c.id };
    expect((await recordConsent(prisma, { ...input, status: "UNKNOWN", source: "manual" })).ok).toBe(false);
    expect((await recordConsent(prisma, { ...input, status: "MAYBE", source: "manual" })).ok).toBe(false);
    expect((await recordConsent(prisma, { ...input, status: "GRANTED", source: "  " })).ok).toBe(false);
    expect((await recordConsent(prisma, { ...input, status: "GRANTED", source: "x".repeat(61) })).ok).toBe(false);
    expect((await recordConsent(prisma, { ...input, status: "GRANTED", source: "manual", note: "n".repeat(501) })).ok).toBe(false);
    expect(await recordConsent(prisma, { workspaceId: other.workspaceId, contactId: c.id, status: "GRANTED", source: "manual" })).toMatchObject({ ok: false, status: 404 });
    expect(await prisma.contactConsentEvent.count({ where: { contactId: c.id } })).toBe(0);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe("UNKNOWN");
  });

  it("treats withdrawn consent as a stop request", async () => {
    const t = await team("withdraw");
    const c = await person(t, "pat");
    await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "GRANTED", source: "manual" });
    const res = await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "WITHDRAWN", source: "dm_reply" });
    expect(res).toEqual({ ok: true, value: { consentStatus: "WITHDRAWN", optedOut: true } });

    const row = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ status: "OPTED_OUT", consentStatus: "WITHDRAWN" });
    const firstOptOut = row.optedOutAt;
    expect(firstOptOut).not.toBeNull();
    expect(await decideDm(prisma, { contactId: c.id, automationId: t.automationId, cooldownHours: 0 })).toEqual({ allow: false, reason: "OPTED_OUT" });

    // withdrawing again keeps the original opt-out time
    await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "WITHDRAWN", source: "manual" });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).optedOutAt?.getTime()).toBe(firstOptOut?.getTime());
    expect(await prisma.contactConsentEvent.count({ where: { contactId: c.id } })).toBe(3);

    // granting again does not silently re-enable messaging
    await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "GRANTED", source: "manual" });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("OPTED_OUT");
  });

  it("assigns a lead to a teammate, only inside the workspace", async () => {
    const t = await team("assign");
    const other = await team("assign2");
    const c = await person(t, "pat");

    expect(await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.nancyId })).toEqual({ ok: true, value: { assignedToUserId: t.nancyId, changed: true } });
    const row = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.assignedToUserId).toBe(t.nancyId);
    expect(row.assignedAt).not.toBeNull();

    // same person again changes nothing
    expect(await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.nancyId })).toMatchObject({ ok: true, value: { changed: false } });
    // someone outside the workspace cannot be assigned
    expect(await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.outsiderId })).toMatchObject({ ok: false, status: 400 });
    // another workspace cannot reach this contact
    expect(await assignContact(prisma, { workspaceId: other.workspaceId, contactId: c.id, userId: other.nancyId })).toMatchObject({ ok: false, status: 404 });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).assignedToUserId).toBe(t.nancyId);

    // unassign
    expect(await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: null })).toMatchObject({ ok: true, value: { assignedToUserId: null, changed: true } });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).assignedAt).toBeNull();
  });

  it("keeps the contact when the assigned teammate's account is deleted", async () => {
    const t = await team("deleted");
    const c = await person(t, "pat");
    await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.nancyId });
    await prisma.user.delete({ where: { id: t.nancyId } });
    const row = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.assignedToUserId).toBeNull();
  });

  it("lists with filters, search and paging, and never across workspaces", async () => {
    const t = await team("list");
    const other = await team("list2");
    const a = await person(t, "alice", "Alice Rivera");
    const b = await person(t, "bob", "Bob Stone");
    const c = await person(t, "carol", "Carol Diaz");
    const d = await person(t, "dave", "Dave Kim");
    const e = await person(t, "erin", "Erin Park");
    await person(other, "frank", "Frank Other");

    await assignContact(prisma, { workspaceId: t.workspaceId, contactId: a.id, userId: t.nancyId });
    await assignContact(prisma, { workspaceId: t.workspaceId, contactId: b.id, userId: t.nancyId });
    await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "GRANTED", source: "manual" });
    await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: d.id, status: "WITHDRAWN", source: "manual" });

    const names = async (extra: Record<string, string>) => {
      const r = await listContacts(prisma, { workspaceId: t.workspaceId, ...extra });
      if (!r.ok) throw new Error(r.error);
      return r.value.items.map((i) => i.displayName).sort();
    };
    expect(await names({})).toEqual(["Alice Rivera", "Bob Stone", "Carol Diaz", "Dave Kim", "Erin Park"]);
    expect(await names({ assignedTo: t.nancyId })).toEqual(["Alice Rivera", "Bob Stone"]);
    expect(await names({ assignedTo: "unassigned" })).toEqual(["Carol Diaz", "Dave Kim", "Erin Park"]);
    expect(await names({ consent: "GRANTED" })).toEqual(["Carol Diaz"]);
    expect(await names({ consent: "WITHDRAWN" })).toEqual(["Dave Kim"]);
    expect(await names({ status: "OPTED_OUT" })).toEqual(["Dave Kim"]);
    expect(await names({ q: "RIVERA" })).toEqual(["Alice Rivera"]);
    expect(await names({ q: "erin" })).toEqual(["Erin Park"]);
    expect(await names({ q: "carol", assignedTo: "unassigned", consent: "GRANTED" })).toEqual(["Carol Diaz"]);
    expect(await names({ q: "alice", assignedTo: "unassigned" })).toEqual([]);

    // paging: search and cursor together, no repeats, nothing missed
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page = await listContacts(prisma, { workspaceId: t.workspaceId, limit: 2, cursor, q: "" });
      if (!page.ok) throw new Error(page.error);
      seen.push(...page.value.items.map((x) => x.id));
      cursor = page.value.nextCursor;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual([a.id, b.id, c.id, d.id, e.id].sort());

    // bad input is a clean error
    expect((await listContacts(prisma, { workspaceId: t.workspaceId, status: "NOPE" })).ok).toBe(false);
    expect((await listContacts(prisma, { workspaceId: t.workspaceId, consent: "NOPE" })).ok).toBe(false);
    expect((await listContacts(prisma, { workspaceId: t.workspaceId, cursor: "garbage" })).ok).toBe(false);
    expect((await listContacts(prisma, { workspaceId: t.workspaceId, limit: "0" })).ok).toBe(false);
  });

  it("announces assignments and consent changes to connected receivers when the feature is on", async () => {
    const t = await team("events");
    const c = await person(t, "pat");
    await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.nancyId }); // flag off
    expect(await prisma.outboxEvent.count({ where: { workspaceId: t.workspaceId } })).toBe(0);

    await withFlag(async () => {
      await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.ownerId });
      await assignContact(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.ownerId }); // no change, no event
      await recordConsent(prisma, { workspaceId: t.workspaceId, contactId: c.id, status: "WITHDRAWN", source: "manual" });
    });
    const events = await prisma.outboxEvent.findMany({ where: { workspaceId: t.workspaceId }, orderBy: { type: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["contact.assigned", "contact.consent_changed", "contact.opted_out"]);
    expect(events[0].payload).toEqual({ contactId: c.id, assignedToUserId: t.ownerId, previousAssignedToUserId: t.nancyId });
    expect(events[1].payload).toEqual({ contactId: c.id, consentStatus: "WITHDRAWN", source: "manual" });
  });
});
