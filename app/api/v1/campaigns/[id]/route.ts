import { apiErrors } from "@/lib/api/errors";
import { jsonOk, readJsonBody, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import {
  explainGuardedKeys,
  updateDraftSchema,
} from "@/lib/services/campaign-schemas";
import { getCampaign, updateDraftCampaign } from "@/lib/services/campaigns";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteProps) {
  return runV1(request, "read", async (ctx, requestId) => {
    const { id } = await params;
    return jsonOk(await getCampaign(prisma, ctx, id), requestId);
  });
}

// Edits inactive drafts only. Active or paused campaigns return 409.
export async function PATCH(request: Request, { params }: RouteProps) {
  return runV1(request, "drafts:write", async (ctx, requestId) => {
    const { id } = await params;
    const body = await readJsonBody(request);

    const guarded = explainGuardedKeys(body);
    if (guarded) throw apiErrors.validation(guarded);

    const parsed = updateDraftSchema.safeParse(body);
    if (!parsed.success) {
      throw apiErrors.validation("Invalid update", parsed.error.flatten());
    }

    const updated = await updateDraftCampaign(
      prisma,
      { ctx, channel: "REST" },
      id,
      parsed.data
    );
    return jsonOk(updated, requestId);
  });
}
