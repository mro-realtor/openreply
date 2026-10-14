import { jsonOk, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import { getContactForApi } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteProps) {
  return runV1(request, "contacts:read", async (ctx, requestId) => {
    const { id } = await params;
    return jsonOk(await getContactForApi(prisma, ctx, id), requestId);
  });
}
