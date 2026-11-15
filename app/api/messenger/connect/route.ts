import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { createOAuthState, getFacebookAuthorizationUrl } from "@/lib/meta/oauth";
import { getBaseUrl } from "@/lib/env";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const callback = `${getBaseUrl()}/api/messenger/callback`;
  return NextResponse.redirect(getFacebookAuthorizationUrl(callback, createOAuthState(context.workspaceId)));
}
