import { jsonOk, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import { listAccounts } from "@/lib/services/accounts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runV1(request, "read", async (ctx, requestId) => {
    const url = new URL(request.url);
    const result = await listAccounts(prisma, ctx, {
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    });
    return jsonOk(result, requestId);
  });
}
