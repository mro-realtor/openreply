import { apiErrors } from "@/lib/api/errors";
import { validateIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { jsonOk, readJsonBody, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import {
  createDraftSchema,
  explainGuardedKeys,
} from "@/lib/services/campaign-schemas";
import {
  createDraftCampaign,
  listCampaigns,
  type CampaignStatusFilter,
} from "@/lib/services/campaigns";

export const dynamic = "force-dynamic";

const STATUS_VALUES = ["draft", "active", "paused"];

export async function GET(request: Request) {
  return runV1(request, "read", async (ctx, requestId) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    if (status && !STATUS_VALUES.includes(status)) {
      throw apiErrors.validation("status must be draft, active or paused");
    }
    const result = await listCampaigns(prisma, ctx, {
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
      accountId: url.searchParams.get("accountId"),
      status: (status as CampaignStatusFilter | null) ?? undefined,
    });
    return jsonOk(result, requestId);
  });
}

// Always creates an inactive draft. There is no way to ask for anything else.
export async function POST(request: Request) {
  return runV1(request, "drafts:write", async (ctx, requestId) => {
    const body = await readJsonBody(request);

    const guarded = explainGuardedKeys(body);
    if (guarded) throw apiErrors.validation(guarded);

    const parsed = createDraftSchema.safeParse(body);
    if (!parsed.success) {
      throw apiErrors.validation("Invalid campaign", parsed.error.flatten());
    }

    const key = validateIdempotencyKey(request.headers.get("idempotency-key"));
    const result = await withIdempotency(
      prisma,
      ctx,
      key,
      "POST /api/v1/campaigns",
      parsed.data,
      async () => ({
        status: 201,
        body: await createDraftCampaign(prisma, { ctx, channel: "REST" }, parsed.data),
      })
    );
    return jsonOk(result.body, requestId, {
      status: result.status,
      headers: result.replayed ? { "Idempotent-Replayed": "true" } : {},
    });
  });
}
