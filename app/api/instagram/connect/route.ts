import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingInstagramOAuthEnv } from "@/lib/env";
import { createOAuthState, getAuthorizationUrl } from "@/lib/meta/oauth";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=forbidden`);
  }

  // getAuthorizationUrl and createOAuthState call requireEnv, which throws.
  // Without this check an incomplete .env surfaces as a 500 on a plain <a>
  // navigation, which reads to the user as the button doing nothing at all.
  const missingEnv = getMissingInstagramOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?instagram=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  // ?account=<id> re-authorizes one existing account without touching the others.
  const reconnectAccountId = request.nextUrl.searchParams.get("account");
  if (reconnectAccountId) {
    const existing = await prisma.instagramAccount.findFirst({
      where: { id: reconnectAccountId, workspaceId: context.workspaceId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.redirect(`${getBaseUrl()}/settings?instagram=invalid`);
    }
  }

  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  const state = createOAuthState(context.workspaceId, {
    userId: context.userId,
    ...(reconnectAccountId ? { reconnectAccountId } : {}),
  });

  return NextResponse.redirect(
    getAuthorizationUrl(redirectUri, state, { forceReauth: Boolean(reconnectAccountId) })
  );
}
