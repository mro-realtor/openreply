import { apiErrors } from "@/lib/api/errors";
import { jsonOk, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import { isLogStatus, listCampaignLogs } from "@/lib/services/logs";

export const dynamic = "force-dynamic";

// Delivery logs with no commenter identity or comment text.
export async function GET(request: Request) {
  return runV1(request, "read", async (ctx, requestId) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    if (status && !isLogStatus(status)) {
      throw apiErrors.validation("Unknown status filter");
    }
    const result = await listCampaignLogs(prisma, ctx, {
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      campaignId: url.searchParams.get("campaignId"),
      status: status && isLogStatus(status) ? status : undefined,
    });
    return jsonOk(result, requestId);
  });
}
