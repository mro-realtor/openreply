import { jsonOk, runV1 } from "@/lib/api/rest";
import { getRedisConnection } from "@/lib/queue/client";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

async function probe(fn: () => Promise<unknown>): Promise<"ok" | "error"> {
  try {
    await fn();
    return "ok";
  } catch {
    return "error";
  }
}

// Authenticated on purpose: nothing about this deployment is public.
export async function GET(request: Request) {
  return runV1(request, "read", async (ctx, requestId) => {
    const [database, redis] = await Promise.all([
      probe(() => prisma.$queryRaw`SELECT 1`),
      probe(() => getRedisConnection().ping()),
    ]);
    return jsonOk(
      {
        status: database === "ok" && redis === "ok" ? "ok" : "degraded",
        version: "v1",
        checks: { database, redis },
        token: { name: ctx.tokenName, scopes: ctx.scopes },
      },
      requestId
    );
  });
}
