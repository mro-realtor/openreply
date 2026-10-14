import { recordAudit } from "@/lib/api/audit";
import { apiErrors } from "@/lib/api/errors";
import {
  buildPage,
  cursorWhere,
  decodeCursor,
  pageOrder,
  parseLimit,
} from "@/lib/api/pagination";
import type { Channel, ApiContext, Db } from "@/lib/api/types";
import {
  buildDraftCreateData,
  buildDraftUpdateData,
  CAMPAIGN_SELECT,
  newTrackedLinkData,
  toCampaignDto,
} from "@/lib/services/campaign-mapper";
import type {
  CreateDraftInput,
  UpdateDraftInput,
} from "@/lib/services/campaign-schemas";

export interface Actor {
  ctx: ApiContext;
  channel: Channel;
}

export type CampaignStatusFilter = "draft" | "active" | "paused";

function statusWhere(status: CampaignStatusFilter | undefined) {
  if (status === "active") return { isActive: true };
  if (status === "draft") return { isActive: false, isDraft: true };
  if (status === "paused") return { isActive: false, isDraft: false };
  return {};
}

export async function listCampaigns(
  db: Db,
  ctx: ApiContext,
  params: {
    limit?: string | number | null;
    cursor?: string | null;
    accountId?: string | null;
    status?: CampaignStatusFilter;
  }
) {
  const limit = parseLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const rows = await db.automation.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(params.accountId ? { instagramAccountId: params.accountId } : {}),
      ...statusWhere(params.status),
      ...cursorWhere(cursor),
    },
    select: CAMPAIGN_SELECT,
    orderBy: pageOrder(),
    take: limit + 1,
  });
  const page = buildPage(rows, limit, (row) => row.createdAt);
  return { items: page.items.map(toCampaignDto), nextCursor: page.nextCursor };
}

/** Delivery counts by status. Read-only, so unlike the dashboard list it writes nothing. */
async function deliveryCounts(db: Db, workspaceId: string, automationId: string) {
  const groups = await db.dmLog.groupBy({
    by: ["status"],
    where: { workspaceId, automationId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

export async function getCampaign(db: Db, ctx: ApiContext, id: string) {
  const row = await db.automation.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: CAMPAIGN_SELECT,
  });
  if (!row) throw apiErrors.notFound("Campaign");
  return {
    ...toCampaignDto(row),
    deliveryCounts: await deliveryCounts(db, ctx.workspaceId, row.id),
  };
}

export async function createDraftCampaign(
  db: Db,
  actor: Actor,
  input: CreateDraftInput
) {
  const { ctx, channel } = actor;

  const account = await db.instagramAccount.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      ...(input.instagramAccountId
        ? { id: input.instagramAccountId }
        : { username: {
              equals: input.instagramUsername!.replace(/^@/, ""),
              mode: "insensitive",
            } }),
    },
    select: { id: true },
  });
  if (!account) {
    throw apiErrors.validation("No connected Instagram account matches that id or username");
  }

  const data = buildDraftCreateData(input);
  const link = input.trackedDestinationUrl
    ? [newTrackedLinkData(ctx.workspaceId, input.trackedDestinationUrl)]
    : [];

  const row = await db.automation.create({
    data: {
      ...data,
      workspaceId: ctx.workspaceId,
      instagramAccountId: account.id,
      ...(link.length > 0 ? { trackedLinks: { create: link } } : {}),
    },
    select: CAMPAIGN_SELECT,
  });

  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    apiTokenId: ctx.tokenId,
    actorUserId: ctx.createdByUserId,
    channel,
    action: "campaign.draft.create",
    targetType: "Automation",
    targetId: row.id,
    outcome: "SUCCESS",
    details: { name: row.name, accountId: account.id },
  });

  return toCampaignDto(row);
}

export async function updateDraftCampaign(
  db: Db,
  actor: Actor,
  id: string,
  input: UpdateDraftInput
) {
  const { ctx, channel } = actor;

  const existing = await db.automation.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, isActive: true, isDraft: true },
  });
  if (!existing) throw apiErrors.notFound("Campaign");
  if (existing.isActive || !existing.isDraft) throw apiErrors.notDraft();

  const data = buildDraftUpdateData(input);

  // The draft conditions are repeated in the write itself, so a human who
  // activates the campaign between the check above and this update wins.
  const result = await db.automation.updateMany({
    where: { id, workspaceId: ctx.workspaceId, isActive: false, isDraft: true },
    data,
  });
  if (result.count === 0) throw apiErrors.notDraft();

  if (input.trackedDestinationUrl !== undefined && input.trackedDestinationUrl !== null) {
    const primary = await db.trackedLink.findFirst({
      where: { automationId: id, workspaceId: ctx.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (input.trackedDestinationUrl === "") {
      if (primary) await db.trackedLink.delete({ where: { id: primary.id } });
    } else if (primary) {
      await db.trackedLink.update({
        where: { id: primary.id },
        data: { destinationUrl: input.trackedDestinationUrl },
      });
    } else {
      await db.trackedLink.create({
        data: { ...newTrackedLinkData(ctx.workspaceId, input.trackedDestinationUrl), automationId: id },
      });
    }
  }

  const row = await db.automation.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: CAMPAIGN_SELECT,
  });
  if (!row) throw apiErrors.notFound("Campaign");

  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    apiTokenId: ctx.tokenId,
    actorUserId: ctx.createdByUserId,
    channel,
    action: "campaign.draft.update",
    targetType: "Automation",
    targetId: id,
    outcome: "SUCCESS",
    details: { fields: Object.keys(input) },
  });

  return toCampaignDto(row);
}
