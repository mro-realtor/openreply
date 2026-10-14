import { describe, expect, it, vi } from "vitest";
import { buildDraftCreateData, buildDraftUpdateData, toCampaignDto, type CampaignRow } from "@/lib/services/campaign-mapper";
import { createDraftSchema, updateDraftSchema } from "@/lib/services/campaign-schemas";
import { createDraftCampaign, updateDraftCampaign } from "@/lib/services/campaigns";
import type { ApiContext, Db } from "@/lib/api/types";

const ctx: ApiContext = { workspaceId: "ws1", tokenId: "t1", tokenName: "n", scopes: ["drafts:write"], createdByUserId: "u1" };
const base = { name: "Spring", instagramUsername: "mro.realtor", keywords: ["CASA"], dmMessage: "hi" };

function row(overrides: Partial<CampaignRow> = {}): CampaignRow {
  const now = new Date("2026-10-14T00:00:00Z");
  return {
    id: "c1", name: "n", goal: null, isActive: false, isDraft: true,
    postId: null, postUrl: null, matchAnyPost: false, pendingNextReel: false,
    keywords: ["CASA"], matchAnyWord: false, wholeWordMatch: true, dmTriggerEnabled: false,
    dmMessage: "hi", openingDmEnabled: false, openingDmMessage: null, openingDmButtonLabel: null,
    linkButtonLabel: null, requireFollow: false, followPromptMessage: null, followPromptButtonLabel: null,
    followGateStrict: false, textOnly: false, defaultAssigneeUserId: null,
    followUpEnabled: false, followUpMessage: null, followUpDelayMinutes: 0,
    publicReplyEnabled: false, publicReplyMessages: [], draftConfig: null,
    createdAt: now, updatedAt: now,
    instagramAccount: { id: "a1", username: "mro.realtor" }, trackedLinks: [],
    ...overrides,
  };
}

function createDb(opts: { member?: boolean } = {}) {
  const create = vi.fn().mockResolvedValue(row());
  const db = {
    instagramAccount: { findFirst: vi.fn().mockResolvedValue({ id: "a1" }) },
    workspaceMember: { findFirst: vi.fn().mockResolvedValue(opts.member === false ? null : { id: "m1" }) },
    automation: { create },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Db;
  return { db, create };
}

function updateDb(existing: Record<string, unknown>, opts: { member?: boolean } = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = {
    automation: {
      findFirst: vi.fn().mockResolvedValueOnce({ id: "c1", isActive: false, isDraft: true, ...existing }).mockResolvedValue(row()),
      updateMany,
    },
    workspaceMember: { findFirst: vi.fn().mockResolvedValue(opts.member === false ? null : { id: "m1" }) },
    trackedLink: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Db;
  return { db, updateMany };
}

describe("draft settings in the builders", () => {
  it("defaults to off, so older clients are unaffected", () => {
    const data = buildDraftCreateData(createDraftSchema.parse(base));
    expect(data).toMatchObject({ followGateStrict: false, textOnly: false, defaultAssigneeUserId: null, isActive: false, isDraft: true });
  });
  it("stores strict only when the follow gate is on", () => {
    const on = buildDraftCreateData(createDraftSchema.parse({ ...base, requireFollow: true, followGateStrict: true }));
    expect(on.followGateStrict).toBe(true);
    const off = buildDraftCreateData(createDraftSchema.parse({ ...base, followGateStrict: true }));
    expect(off.followGateStrict).toBe(false);
  });
  it("turning the follow gate off in an update also clears strict", () => {
    expect(buildDraftUpdateData({ requireFollow: false }).followGateStrict).toBe(false);
    expect(buildDraftUpdateData({ followGateStrict: true }).followGateStrict).toBe(true);
    expect(buildDraftUpdateData({ defaultAssigneeUserId: null }).defaultAssigneeUserId).toBeNull();
  });
  it("still refuses to set isActive or isDraft", () => {
    expect(createDraftSchema.safeParse({ ...base, isActive: true }).success).toBe(false);
    expect(updateDraftSchema.safeParse({ isDraft: false }).success).toBe(false);
    const data = buildDraftUpdateData({ textOnly: true, defaultAssigneeUserId: "u2" });
    expect("isActive" in data || "isDraft" in data).toBe(false);
  });
  it("shows the settings on the campaign DTO", () => {
    const dto = toCampaignDto(row({ followGateStrict: true, requireFollow: true, textOnly: false, defaultAssigneeUserId: "u2" }));
    expect(dto.followGate).toMatchObject({ enabled: true, strict: true });
    expect(dto.settings).toEqual({ textOnly: false, defaultAssigneeUserId: "u2" });
  });
});

describe("draft settings in the services", () => {
  it("creates a draft with the settings and checks the teammate belongs to the workspace", async () => {
    const { db, create } = createDb();
    await createDraftCampaign(db, { ctx, channel: "MCP" }, createDraftSchema.parse({ ...base, requireFollow: true, followGateStrict: true, defaultAssigneeUserId: "u2" }));
    expect((db.workspaceMember.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where).toEqual({ workspaceId: "ws1", userId: "u2" });
    expect(create.mock.calls[0][0].data).toMatchObject({ followGateStrict: true, defaultAssigneeUserId: "u2", isActive: false, isDraft: true });
  });
  it("refuses a teammate from another workspace and writes nothing", async () => {
    const { db, create } = createDb({ member: false });
    const err = await createDraftCampaign(db, { ctx, channel: "REST" }, createDraftSchema.parse({ ...base, defaultAssigneeUserId: "stranger" })).catch((e) => e);
    expect(err.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses strict without the follow gate, and text-only with a button feature", async () => {
    for (const extra of [{ followGateStrict: true }, { textOnly: true, requireFollow: true }, { textOnly: true, openingDmEnabled: true, openingDmMessage: "m", openingDmButtonLabel: "b" }]) {
      const { db, create } = createDb();
      const err = await createDraftCampaign(db, { ctx, channel: "REST" }, createDraftSchema.parse({ ...base, ...extra })).catch((e) => e);
      expect(err.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    }
  });
  it("checks an update against the saved draft, not just the fields sent", async () => {
    const { db, updateMany } = updateDb({ requireFollow: true, followGateStrict: false, textOnly: false, openingDmEnabled: false });
    const err = await updateDraftCampaign(db, { ctx, channel: "MCP" }, "c1", { textOnly: true }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("allows turning the follow gate off and text-only on in one update", async () => {
    const { db, updateMany } = updateDb({ requireFollow: true, followGateStrict: true, textOnly: false, openingDmEnabled: false });
    await updateDraftCampaign(db, { ctx, channel: "MCP" }, "c1", { requireFollow: false, textOnly: true });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ requireFollow: false, followGateStrict: false, textOnly: true });
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ isActive: false, isDraft: true });
  });
  it("refuses an update that names a teammate outside the workspace", async () => {
    const { db, updateMany } = updateDb({ requireFollow: false, followGateStrict: false, textOnly: false, openingDmEnabled: false }, { member: false });
    const err = await updateDraftCampaign(db, { ctx, channel: "REST" }, "c1", { defaultAssigneeUserId: "stranger" }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
