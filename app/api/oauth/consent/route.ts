import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getIssuer, isOAuthEnabled } from "@/lib/oauth/config";
import { OAuthError, notFoundResponse } from "@/lib/oauth/errors";
import { decideAuthorization } from "@/lib/oauth/service";
import { canManageBilling, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function back(request: NextRequest, message: string) {
  const url = new URL("/oauth/consent", request.nextUrl.origin);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url, 303);
}

/**
 * Receives the owner's Approve or Deny. Protected three ways: the session
 * cookie, a same-origin check, and the single-use random request id that only
 * the redirected browser knows (the request is bound to the signed-in user).
 */
export async function POST(request: NextRequest) {
  if (!isOAuthEnabled()) return notFoundResponse();

  const origin = request.headers.get("origin");
  if (origin && origin !== getIssuer()) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }

  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManageBilling(context.role)) {
    return NextResponse.json({ error: "Only the workspace owner can connect apps" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const requestId = String(form?.get("request") ?? "");
  const approve = form?.get("decision") === "approve";
  const approvedScopes = (form?.getAll("scope") ?? []).map(String);

  try {
    const decision = await decideAuthorization(prisma, {
      requestId,
      userId: context.userId,
      workspaceId: context.workspaceId,
      approve,
      approvedScopes,
    });
    return NextResponse.redirect(decision.redirectTo, 303);
  } catch (error) {
    if (error instanceof OAuthError) return back(request, error.message);
    throw error;
  }
}
