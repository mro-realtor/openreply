import { describe, expect, it, vi } from "vitest";
import {
  activationChecklist,
  buildDraftCreateData,
  buildDraftUpdateData,
  campaignStatus,
  toCampaignDto,
  type CampaignRow,
} from "@/lib/services/campaign-mapper";
import {
  createDraftSchema,
  explainGuardedKeys,
  updateDraftSchema,
} from "@/lib/services/campaign-schemas";
import { createDraftCampaign, updateDraftCampaign } from "@/lib/services/campaigns";
import type { ApiContext, Db } from "@/lib/api/types";

const casa = {
  name: "NOR | Historia Primera Casa | CASA",
  instagramUsername: "@mro.realtor",
  keywords: ["CASA"],
  dmMessage: "Hola! Gracias por ver nuestra historia.",
  publicReplyEnabled: true,
  publicReplyMessages: ["Gracias por comentar! Te mandamos un mensajito por privado"],
  requireFollow: true,
  followPromptMessage: "Siguenos primero y toca el boton.",
  followPromptButtonLabel: "Ya te sigo",
  draftConfig: {
    conversationMode: "direct_capture" as const,
    leadCapture: {
      requiredFields: ["full_name", "phone", "contact_authorization"] as const,
      markReadyOnlyWhenComplete: true,
    },
    assignee: "Nancy Orellana",
  },
};

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

describe("draft input validation", () => {
  it("accepts the CASA acceptance campaign with no reel selected", () => {
    const parsed = createDraftSchema.safeParse(casa);
    expect(parsed.success).toBe(true);
  });

  it("rejects attempts to set isActive, isDraft or workspace fields", () => {
    for (const key of ["isActive", "isDraft", "workspaceId", "id"]) {
      const body = { ...casa, [key]: key === "isActive" || key === "isDraft" ? true : "x" };
      expect(createDraftSchema.safeParse(body).success).toBe(false);
      expect(explainGuardedKeys(body)).toContain(key);
    }
    expect(updateDraftSchema.safeParse({ isActive: true }).success).toBe(false);
  });

  it("requires exactly one account selector", () => {
    const { instagramUsername, ...none } = casa;
    void instagramUsername;
    expect(createDraftSchema.safeParse(none).success).toBe(false);
    expect(createDraftSchema.safeParse({ ...casa, instagramAccountId: "a1" }).success).toBe(false);
  });

  it("rejects unknown keys and bad lead capture config", () => {
    expect(createDraftSchema.safeParse({ ...casa, surprise: 1 }).success).toBe(false);
    expect(
      createDraftSchema.safeParse({ ...casa, draftConfig: { conversationMode: "yolo" } }).success
    ).toBe(false);
  });

  it("requires message and label when opening DM is enabled", () => {
    expect(createDraftSchema.safeParse({ ...casa, openingDmEnabled: true }).success).toBe(false);
    expect(updateDraftSchema.safeParse({}).success).toBe(false);
  });
});

describe("draft data builders", () => {
  it("always produces an inactive draft", () => {
    const data = buildDraftCreateData(createDraftSchema.parse(casa));
    expect(data.isActive).toBe(false);
    expect(data.isDraft).toBe(true);
    expect(data.postId).toBeNull();
    expect(data.matchAnyPost).toBe(false);
    expect(data.keywords).toEqual(["CASA"]);
    expect(data.publicReplyMessage).toBe(data.publicReplyMessages[0]);
    expect(data.draftConfig).toMatchObject({ assignee: "Nancy Orellana" });
  });

  it("dedupes keywords and clears dependent fields", () => {
    const data = buildDraftCreateData(
      createDraftSchema.parse({
        ...casa,
        keywords: ["casa", "CASA", " Casa "],
        requireFollow: false,
        publicReplyEnabled: false,
      })
    );
    expect(data.keywords).toEqual(["casa"]);
    expect(data.followPromptMessage).toBeNull();
    expect(data.publicReplyMessages).toEqual([]);
  });

  it("never lets an update change isActive or isDraft", () => {
    const data = buildDraftUpdateData({ name: "x", matchAnyWord: true, requireFollow: false });
    expect("isActive" in data).toBe(false);
    expect("isDraft" in data).toBe(false);
    expect(data.keywords).toEqual([]);
    expect(data.followPromptMessage).toBeNull();
  });
});

describe("campaign dto", () => {
  it("derives status and lists what blocks activation", () => {
    expect(campaignStatus({ isActive: false, isDraft: true })).toBe("draft");
    expect(campaignStatus({ isActive: true, isDraft: false })).toBe("active");
    expect(campaignStatus({ isActive: false, isDraft: false })).toBe("paused");
    const issues = activationChecklist(row());
    expect(issues.some((i) => i.includes("No post selected"))).toBe(true);
    expect(activationChecklist(row({ matchAnyPost: true }))).toEqual([]);
  });

  it("exposes no share slug or token fields", () => {
    const dto = toCampaignDto(row({
      trackedLinks: [{ id: "l1", slug: "abc123", label: "x", destinationUrl: "https://example.com" }],
    }));
    const text = JSON.stringify(dto);
    expect(text).not.toMatch(/accessToken|reportShareSlug|workspaceId/);
    expect(dto.trackedLinks[0].trackedUrl).toContain("abc123");
  });
});

const ctx: ApiContext = { workspaceId: "ws1", tokenId: "t1", tokenName: "n", scopes: ["drafts:write"], createdByUserId: "u1" };

describe("draft services", () => {
  it("creates in the token's workspace as an inactive draft and audits it", async () => {
    const create = vi.fn().mockResolvedValue(row({ name: casa.name }));
    const findAccount = vi.fn().mockResolvedValue({ id: "a1" });
    const auditCreate = vi.fn().mockResolvedValue({});
    const db = {
      instagramAccount: { findFirst: findAccount },
      automation: { create },
      auditLog: { create: auditCreate },
    } as unknown as Db;

    await createDraftCampaign(db, { ctx, channel: "MCP" }, createDraftSchema.parse(casa));

    const where = findAccount.mock.calls[0][0].where;
    expect(where.workspaceId).toBe("ws1");
    expect(where.username.equals).toBe("mro.realtor"); // "@" stripped
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ workspaceId: "ws1", instagramAccountId: "a1", isActive: false, isDraft: true });
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({ action: "campaign.draft.create", channel: "MCP", outcome: "SUCCESS" });
  });

  it("refuses an account from another workspace", async () => {
    const db = { instagramAccount: { findFirst: vi.fn().mockResolvedValue(null) }, automation: { create: vi.fn() } } as unknown as Db;
    const err = await createDraftCampaign(db, { ctx, channel: "REST" }, createDraftSchema.parse(casa)).catch((e) => e);
    expect(err.status).toBe(400);
    expect((db.automation.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("will not edit an active or paused campaign", async () => {
    for (const existing of [{ id: "c1", isActive: true, isDraft: false }, { id: "c1", isActive: false, isDraft: false }]) {
      const updateMany = vi.fn();
      const db = { automation: { findFirst: vi.fn().mockResolvedValue(existing), updateMany } } as unknown as Db;
      const err = await updateDraftCampaign(db, { ctx, channel: "REST" }, "c1", { name: "x" }).catch((e) => e);
      expect(err.code).toBe("CAMPAIGN_NOT_DRAFT");
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it("repeats the draft conditions in the write so a concurrent activation wins", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = {
      automation: {
        findFirst: vi.fn().mockResolvedValue({ id: "c1", isActive: false, isDraft: true }),
        updateMany,
      },
    } as unknown as Db;
    const err = await updateDraftCampaign(db, { ctx, channel: "REST" }, "c1", { name: "x" }).catch((e) => e);
    expect(err.code).toBe("CAMPAIGN_NOT_DRAFT");
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "ws1", isActive: false, isDraft: true });
  });

  it("returns 404 for another workspace's campaign", async () => {
    const db = { automation: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as Db;
    const err = await updateDraftCampaign(db, { ctx, channel: "REST" }, "other", { name: "x" }).catch((e) => e);
    expect(err.status).toBe(404);
    expect((db.automation.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where.workspaceId).toBe("ws1");
  });
});
