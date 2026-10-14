import { jsonOk, runV1 } from "@/lib/api/rest";
import { prisma } from "@/lib/db/client";
import { listContactsForApi } from "@/lib/services/contacts";

export const dynamic = "force-dynamic";

/**
 * People who interacted with this workspace's accounts. Read-only.
 * Query: q, status (ACTIVE|OPTED_OUT), consent (UNKNOWN|GRANTED|WITHDRAWN),
 * assignedTo (unassigned or a user id), identity (PLATFORM:externalId), limit, cursor.
 */
export async function GET(request: Request) {
  return runV1(request, "contacts:read", async (ctx, requestId) => {
    const sp = new URL(request.url).searchParams;
    const result = await listContactsForApi(prisma, ctx, {
      q: sp.get("q"),
      status: sp.get("status"),
      consent: sp.get("consent"),
      assignedTo: sp.get("assignedTo"),
      identity: sp.get("identity"),
      limit: sp.get("limit"),
      cursor: sp.get("cursor"),
    });
    return jsonOk(result, requestId);
  });
}
