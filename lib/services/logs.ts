import { redactString } from "@/lib/api/redact";
import {
  buildPage,
  cursorWhere,
  decodeCursor,
  pageOrder,
  parseLimit,
} from "@/lib/api/pagination";
import type { ApiContext, Db } from "@/lib/api/types";

/**
 * Delivery log view. It intentionally omits commenterId, commenterName and
 * commentText: those identify real people and belong behind the reserved
 * `leads:read` scope, which no token can hold yet.
 */
const LOG_SELECT = {
  id: true,
  automationId: true,
  status: true,
  matchedKeyword: true,
  attempts: true,
  dmSentAt: true,
  errorMessage: true,
  publicReplySentAt: true,
  publicReplyError: true,
  createdAt: true,
} as const;

const STATUSES = [
  "PENDING",
  "SENT",
  "FAILED",
  "SKIPPED_DEDUP",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_NO_MATCH",
] as const;
export type LogStatus = (typeof STATUSES)[number];

export function isLogStatus(value: string): value is LogStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export async function listCampaignLogs(
  db: Db,
  ctx: ApiContext,
  params: {
    limit?: string | number | null;
    cursor?: string | null;
    campaignId?: string | null;
    status?: LogStatus;
  }
) {
  const limit = parseLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const rows = await db.dmLog.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      ...(params.campaignId ? { automationId: params.campaignId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...cursorWhere(cursor),
    },
    select: LOG_SELECT,
    orderBy: pageOrder(),
    take: limit + 1,
  });
  const page = buildPage(rows, limit, (row) => row.createdAt);
  return {
    items: page.items.map((row) => ({
      id: row.id,
      campaignId: row.automationId,
      status: row.status,
      matchedKeyword: row.matchedKeyword,
      attempts: row.attempts,
      dmSentAt: row.dmSentAt ? row.dmSentAt.toISOString() : null,
      errorMessage: row.errorMessage ? redactString(row.errorMessage) : null,
      publicReplySentAt: row.publicReplySentAt
        ? row.publicReplySentAt.toISOString()
        : null,
      publicReplyError: row.publicReplyError
        ? redactString(row.publicReplyError)
        : null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}
