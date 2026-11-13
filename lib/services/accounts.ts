import { apiErrors } from "@/lib/api/errors";
import {
  buildPage,
  cursorWhere,
  decodeCursor,
  pageOrder,
  parseLimit,
} from "@/lib/api/pagination";
import type { ApiContext, Db } from "@/lib/api/types";

/**
 * Read-only account views. The select list is explicit and deliberately has
 * no `accessToken`, so a token can never leak through this layer.
 */
const ACCOUNT_SELECT = {
  id: true,
  instagramId: true,
  username: true,
  name: true,
  connectedAt: true,
  tokenExpiresAt: true,
  webhookSubscribed: true,
  _count: { select: { automations: true } },
} as const;

interface AccountRow {
  id: string;
  instagramId: string;
  username: string;
  name: string | null;
  connectedAt: Date;
  tokenExpiresAt: Date | null;
  webhookSubscribed: boolean;
  _count: { automations: number };
}

export type TokenHealth = "valid" | "expiring_soon" | "expired" | "unknown";

const EXPIRING_SOON_DAYS = 10;

export function tokenHealth(expiresAt: Date | null, now = new Date()): TokenHealth {
  if (!expiresAt) return "unknown";
  const msLeft = expiresAt.getTime() - now.getTime();
  if (msLeft <= 0) return "expired";
  return msLeft < EXPIRING_SOON_DAYS * 86_400_000 ? "expiring_soon" : "valid";
}

export function toAccountDto(row: AccountRow, now = new Date()) {
  return {
    id: row.id,
    platform: "instagram" as const,
    instagramId: row.instagramId,
    username: row.username,
    name: row.name,
    connectedAt: row.connectedAt.toISOString(),
    status: {
      webhookSubscribed: row.webhookSubscribed,
      tokenHealth: tokenHealth(row.tokenExpiresAt, now),
      tokenExpiresAt: row.tokenExpiresAt ? row.tokenExpiresAt.toISOString() : null,
    },
    campaignCount: row._count.automations,
  };
}

export async function listAccounts(
  db: Db,
  ctx: ApiContext,
  params: { limit?: string | number | null; cursor?: string | null }
) {
  const limit = parseLimit(params.limit);
  const cursor = decodeCursor(params.cursor);
  const rows = await db.instagramAccount.findMany({
    where: { workspaceId: ctx.workspaceId, ...cursorWhere(cursor, "connectedAt") },
    select: ACCOUNT_SELECT,
    orderBy: pageOrder("connectedAt"),
    take: limit + 1,
  });
  const page = buildPage(rows, limit, (row) => row.connectedAt);
  return { items: page.items.map((row) => toAccountDto(row)), nextCursor: page.nextCursor };
}

export async function getAccount(db: Db, ctx: ApiContext, id: string) {
  const row = await db.instagramAccount.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: ACCOUNT_SELECT,
  });
  if (!row) throw apiErrors.notFound("Account");
  return toAccountDto(row);
}
