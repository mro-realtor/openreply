import { jsonOk, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import { getAccount } from "@/lib/services/accounts";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Account details and connection status (token health, webhook state).
export async function GET(request: Request, { params }: RouteProps) {
  return runV1(request, "read", async (ctx, requestId) => {
    const { id } = await params;
    return jsonOk(await getAccount(prisma, ctx, id), requestId);
  });
}
