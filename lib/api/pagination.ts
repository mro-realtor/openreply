import { z } from "zod";
import { apiErrors } from "@/lib/api/errors";

/**
 * Cursor pagination over (createdAt desc, id desc). Cursors are opaque to
 * clients and are validated on decode so a tampered cursor is a 400, never a
 * query error.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const cursorSchema = z.object({ c: z.string().datetime(), i: z.string().min(1) });

export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(item: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ c: item.createdAt.toISOString(), i: item.id })
  ).toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    );
    return { createdAt: new Date(parsed.c), id: parsed.i };
  } catch {
    throw apiErrors.validation("Invalid cursor");
  }
}

export function parseLimit(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_PAGE_SIZE;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw apiErrors.validation("limit must be a positive integer");
  }
  return Math.min(n, MAX_PAGE_SIZE);
}

/**
 * Prisma `where` fragment selecting rows strictly after the cursor. `field`
 * is the timestamp column the list is ordered by (default `createdAt`).
 */
export function cursorWhere(cursor: Cursor | null, field = "createdAt") {
  if (!cursor) return {};
  return {
    OR: [
      { [field]: { lt: cursor.createdAt } },
      { [field]: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function pageOrder(field = "createdAt") {
  return [{ [field]: "desc" as const }, { id: "desc" as const }];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Pass rows fetched with `take: limit + 1`. */
export function buildPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  getDate: (row: T) => Date
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: getDate(last), id: last.id }) : null,
  };
}
