import { createHash } from "node:crypto";
import { apiErrors } from "@/lib/api/errors";
import type { ApiContext, Db } from "@/lib/api/types";

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

export function validateIdempotencyKey(key: string | null | undefined): string | null {
  if (key === null || key === undefined || key === "") return null;
  if (!KEY_PATTERN.test(key)) {
    throw apiErrors.validation(
      "Idempotency-Key must be 8 to 128 characters: letters, digits, _ - : ."
    );
  }
  return key;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashRequest(operation: string, body: unknown): string {
  return createHash("sha256")
    .update(`${operation}\n${stableStringify(body)}`)
    .digest("hex");
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** A claimed key whose request never finished is treated as abandoned after this. */
const STALE_CLAIM_MS = 60_000;
const PENDING_STATUS = 0;

/**
 * Runs `execute` at most once per (token, key).
 *
 * The key is claimed with a placeholder row BEFORE executing, so two
 * simultaneous identical requests cannot both run. A repeat with the same
 * body returns the stored response; a different body is rejected; a repeat
 * while the first is still running gets a 409. With no key the call simply runs.
 */
export async function withIdempotency<T>(
  db: Db,
  ctx: ApiContext,
  key: string | null,
  operation: string,
  requestBody: unknown,
  execute: () => Promise<{ status: number; body: T }>
): Promise<IdempotentResult<T>> {
  if (!key) {
    const fresh = await execute();
    return { ...fresh, replayed: false };
  }

  const requestHash = hashRequest(operation, requestBody);
  const where = { apiTokenId_key: { apiTokenId: ctx.tokenId, key } };

  for (let attempt = 0; attempt < 2; attempt++) {
    let claimId: string | null = null;
    try {
      const claim = await db.idempotencyKey.create({
        data: {
          apiTokenId: ctx.tokenId,
          key,
          requestHash,
          responseStatus: PENDING_STATUS,
          responseBody: {},
          expiresAt: new Date(Date.now() + TTL_MS),
        },
        select: { id: true },
      });
      claimId = claim.id;
    } catch {
      const existing = await db.idempotencyKey.findUnique({ where });
      if (!existing) continue; // vanished between calls, try the claim again

      const age = Date.now() - existing.createdAt.getTime();
      const expired = existing.expiresAt.getTime() <= Date.now();
      const abandoned =
        existing.responseStatus === PENDING_STATUS && age > STALE_CLAIM_MS;
      if (expired || abandoned) {
        await db.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => {});
        continue;
      }
      if (existing.requestHash !== requestHash) throw apiErrors.idempotencyReused();
      if (existing.responseStatus === PENDING_STATUS) {
        throw apiErrors.idempotencyInProgress();
      }
      return {
        status: existing.responseStatus,
        body: existing.responseBody as T,
        replayed: true,
      };
    }

    try {
      const fresh = await execute();
      await db.idempotencyKey
        .update({
          where: { id: claimId },
          data: {
            responseStatus: fresh.status,
            responseBody: fresh.body as object,
          },
        })
        .catch(() => {});
      return { ...fresh, replayed: false };
    } catch (error) {
      // Free the key so the client can retry after fixing the problem.
      await db.idempotencyKey.delete({ where: { id: claimId } }).catch(() => {});
      throw error;
    }
  }
  throw apiErrors.idempotencyInProgress();
}
