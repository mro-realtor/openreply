import { getRedisConnection } from "@/lib/queue/client";
import type { RateLimitStore } from "@/lib/api/rate-limit";

export const redisRateLimitStore: RateLimitStore = {
  async increment(key, ttlSeconds) {
    const redis = getRedisConnection();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ttlSeconds);
    return count;
  },
};
