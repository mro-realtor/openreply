import { jsonOk, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import { listContactHistoryForApi } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Campaign activity for one contact. Never includes the text of their comments. */
export async function GET(request: Request, { params }: RouteProps) {
  return runV1(request, "contacts:read", async (ctx, requestId) => {
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const result = await listContactHistoryForApi(prisma, ctx, id, {
      limit: sp.get("limit"),
      cursor: sp.get("cursor"),
    });
    return jsonOk(result, requestId);
  });
}
