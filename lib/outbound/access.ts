import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { isOutboundWebhooksEnabled } from "./config";

/** Owner or admin only, and only while the feature flag is on. */
export async function requireOutboundManager(): Promise<
  { ok: true; workspaceId: string } | { ok: false; response: NextResponse }
> {
  if (!isOutboundWebhooksEnabled()) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Not found" }, { status: 404 }) };
  }
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canManageWorkspace(ctx.role)) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, workspaceId: ctx.workspaceId };
}
