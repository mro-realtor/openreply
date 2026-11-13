import { apiErrors } from "@/lib/api/errors";
import { enforceRateLimit, type RateLimitStore } from "@/lib/api/rate-limit";
import { hasScope, type Scope } from "@/lib/api/scopes";
import {
  getTokenState,
  hashApiToken,
  isWellFormedToken,
  parseBearerToken,
} from "@/lib/api/tokens";
import type { ApiContext, Db } from "@/lib/api/types";

const LAST_USED_THROTTLE_MS = 60_000;

export interface AuthDeps {
  rateLimitStore: RateLimitStore;
  now?: Date;
}

/**
 * Authenticates an API request from its Authorization header.
 *
 * Every failure before the hash lookup returns the same generic 401, so a
 * caller cannot tell a malformed token from an unknown one.
 */
export async function authenticateBearer(
  db: Db,
  authorizationHeader: string | null,
  deps: AuthDeps
): Promise<ApiContext> {
  const secret = parseBearerToken(authorizationHeader);
  if (!secret || !isWellFormedToken(secret)) throw apiErrors.unauthenticated();

  const record = await db.apiToken.findUnique({
    where: { tokenHash: hashApiToken(secret) },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      createdByUserId: true,
    },
  });
  if (!record) throw apiErrors.unauthenticated();

  const now = deps.now ?? new Date();
  if (getTokenState(record, now) !== "active") {
    throw apiErrors.unauthenticated("This API token is expired or revoked");
  }

  await enforceRateLimit(deps.rateLimitStore, record.id, { now: now.getTime() });

  // Operational bookkeeping only; throttled so reads are not write-heavy.
  if (
    !record.lastUsedAt ||
    now.getTime() - record.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS
  ) {
    await db.apiToken
      .update({ where: { id: record.id }, data: { lastUsedAt: now } })
      .catch(() => {});
  }

  return {
    workspaceId: record.workspaceId,
    tokenId: record.id,
    tokenName: record.name,
    scopes: record.scopes,
    createdByUserId: record.createdByUserId,
  };
}

export function requireScope(ctx: ApiContext, scope: Scope): void {
  if (!hasScope(ctx.scopes, scope)) {
    throw apiErrors.forbidden(`This token needs the "${scope}" scope`);
  }
}
