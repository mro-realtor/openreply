import { ApiError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { redisRateLimitStore } from "@/lib/api/redis-rate-limit-store";
import { OAuthError } from "@/lib/oauth/errors";

/** Best-effort client address behind the reverse proxy; only used to bucket rate limits. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

/** Per-IP fixed window limit for the unauthenticated OAuth endpoints. Fails closed. */
export async function limitByIp(request: Request, name: string, perMinute: number): Promise<void> {
  try {
    await enforceRateLimit(redisRateLimitStore, `oauth:${name}:${getClientIp(request)}`, {
      limit: perMinute,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw new OAuthError(
        error.status === 429 ? "temporarily_unavailable" : "server_error",
        error.status === 429 ? "Too many requests" : "Rate limiter unavailable",
        error.status,
        error.headers ?? {}
      );
    }
    throw error;
  }
}
