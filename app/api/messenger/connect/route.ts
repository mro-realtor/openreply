import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { createOAuthState, getFacebookAuthorizationUrl } from "@/lib/meta/oauth";

export async function GET(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const callback = `${url.origin}/api/messenger/callback`;
  return NextResponse.redirect(getFacebookAuthorizationUrl(callback, createOAuthState(context.workspaceId)));
}
