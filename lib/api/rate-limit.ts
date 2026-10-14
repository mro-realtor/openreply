import { apiErrors } from "@/lib/api/errors";

/**
 * Fixed-window rate limiter per API token. The store is injectable so the
 * logic is testable without Redis.
 */

export interface RateLimitStore {
  /** Increments the counter for `key`, sets its TTL on first use, returns the new count. */
  increment(key: string, ttlSeconds: number): Promise<number>;
}

export const WINDOW_SECONDS = 60;

export function getRateLimitPerMinute(): number {
  const raw = Number(process.env.API_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(raw) && raw > 0 ? raw : 120;
}

export async function enforceRateLimit(
  store: RateLimitStore,
  tokenId: string,
  options: { limit?: number; now?: number } = {}
): Promise<void> {
  const limit = options.limit ?? getRateLimitPerMinute();
  const nowMs = options.now ?? Date.now();
  const windowStart = Math.floor(nowMs / 1000 / WINDOW_SECONDS);
  let count: number;
  try {
    count = await store.increment(
      `api-rl:${tokenId}:${windowStart}`,
      WINDOW_SECONDS + 5
    );
  } catch {
    // Fail closed: an admin API with no working limiter should not be open.
    throw apiErrors.unavailable("Rate limiter unavailable");
  }
  if (count > limit) {
    const elapsed = Math.floor(nowMs / 1000) % WINDOW_SECONDS;
    throw apiErrors.rateLimited(Math.max(1, WINDOW_SECONDS - elapsed));
  }
}
