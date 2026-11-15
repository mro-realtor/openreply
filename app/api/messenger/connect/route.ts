import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { createOAuthState, getFacebookAuthorizationUrl } from "@/lib/meta/oauth";

const PUBLIC_APP_URL = "https://sdo-agents-mrorealtor-web.nd2api.easypanel.host";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const callback = `${PUBLIC_APP_URL}/api/messenger/callback`;
  return NextResponse.redirect(getFacebookAuthorizationUrl(callback, createOAuthState(context.workspaceId)));
}
