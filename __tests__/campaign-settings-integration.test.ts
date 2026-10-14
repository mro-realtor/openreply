/**
 * Runs against a real, disposable Postgres. Skipped unless RUN_DB_TESTS=1.
 * Covers the new campaign columns and the default-teammate assignment.
 */
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { applyDefaultAssignee, resolveContact } from "@/lib/contacts/service";

const run = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const suffix = randomBytes(4).toString("hex");
const userIds: string[] = [];
let seq = 0;

async function user(label: string) {
  const u = await prisma.user.create({ data: { email: `${label}-${suffix}-${++seq}@example.test` } });
  userIds.push(u.id);
  return u.id;
}

async function setup(label: string) {
  const ownerId = await user(`${label}-owner`);
  const nancyId = await user(`${label}-nancy`);
  const outsiderId = await user(`${label}-outsider`);
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
  return { workspaceId: ws.id, ownerId, nancyId, outsiderId, accountId: acct.id };
}

async function person(workspaceId: string, handle: string) {
  return resolveContact(prisma, { workspaceId, platform: "INSTAGRAM", externalId: `x-${handle}-${suffix}-${++seq}`, handle, displayName: handle });
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

run("campaign composer settings (database)", () => {
  it("new settings default to off, so existing behaviour is unchanged", async () => {
    const t = await setup("defaults");
    const a = await prisma.automation.create({
      data: { name: "A", dmMessage: "hi", workspaceId: t.workspaceId, instagramAccountId: t.accountId },
    });
    expect(a).toMatchObject({ followGateStrict: false, textOnly: false, defaultAssigneeUserId: null });
  });

  it("stores the three settings and a draft stays inactive", async () => {
    const t = await setup("store");
    const a = await prisma.automation.create({
      data: {
        name: "A", dmMessage: "hi", workspaceId: t.workspaceId, instagramAccountId: t.accountId,
        isActive: false, isDraft: true, followGateStrict: true, textOnly: false, defaultAssigneeUserId: t.nancyId,
      },
    });
    expect(a).toMatchObject({ isActive: false, isDraft: true, followGateStrict: true, defaultAssigneeUserId: t.nancyId });
  });

  it("assigns a new person to the default teammate and emits contact.assigned", async () => {
    const t = await setup("assign");
    const c = await person(t.workspaceId, "pat");
    const ok = await withFlag(() => applyDefaultAssignee(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.nancyId }));
    expect(ok).toBe(true);
    const row = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.assignedToUserId).toBe(t.nancyId);
    const ev = await prisma.outboxEvent.findFirst({ where: { workspaceId: t.workspaceId, type: "contact.assigned" } });
    expect(ev).not.toBeNull();
    expect(JSON.stringify(ev?.payload)).toContain("campaign_default");
  });

  it("never overrides an existing assignee", async () => {
    const t = await setup("keep");
    const c = await person(t.workspaceId, "sam");
    await prisma.contact.update({ where: { id: c.id }, data: { assignedToUserId: t.ownerId } });
    const ok = await applyDefaultAssignee(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.nancyId });
    expect(ok).toBe(false);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).assignedToUserId).toBe(t.ownerId);
  });

  it("ignores someone who is not a member of the workspace", async () => {
    const t = await setup("outsider");
    const c = await person(t.workspaceId, "lee");
    const ok = await applyDefaultAssignee(prisma, { workspaceId: t.workspaceId, contactId: c.id, userId: t.outsiderId });
    expect(ok).toBe(false);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).assignedToUserId).toBeNull();
  });

  it("does not touch a contact in another workspace", async () => {
    const a = await setup("wsa");
    const b = await setup("wsb");
    const c = await person(b.workspaceId, "kim");
    const ok = await applyDefaultAssignee(prisma, { workspaceId: a.workspaceId, contactId: c.id, userId: a.nancyId });
    expect(ok).toBe(false);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).assignedToUserId).toBeNull();
  });

  it("deleting the default teammate clears the campaign default instead of deleting the campaign", async () => {
    const t = await setup("delete");
    const a = await prisma.automation.create({
      data: { name: "A", dmMessage: "hi", workspaceId: t.workspaceId, instagramAccountId: t.accountId, defaultAssigneeUserId: t.nancyId },
    });
    await prisma.user.delete({ where: { id: t.nancyId } });
    const after = await prisma.automation.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.defaultAssigneeUserId).toBeNull();
  });
});
