import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { isOAuthEnabled } from "@/lib/oauth/config";
import { OAuthError, notFoundResponse } from "@/lib/oauth/errors";
import { limitByIp } from "@/lib/oauth/limit";
import {
  buildAuthorizationRedirect,
  createAuthorizationRequest,
  validateAuthorizeRequest,
} from "@/lib/oauth/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorPage(message: string, status = 400) {
  const safe = message.replace(/[<>&]/g, "");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>OpenReply</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Cannot connect this application</h1><p>${safe}</p><p>Nothing was shared. You can close this tab.</p>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

/**
 * Starts an authorization. The request is validated first, then the owner must
 * be signed in; the consent screen (a separate page) is where access is granted.
 */
export async function GET(request: NextRequest) {
  if (!isOAuthEnabled()) return notFoundResponse();
  try {
    await limitByIp(request, "authorize", 60);
  } catch (error) {
    if (error instanceof OAuthError) return errorPage(error.message, error.status);
    throw error;
  }

  const q = request.nextUrl.searchParams;
  const result = await validateAuthorizeRequest(prisma, {
    clientId: q.get("client_id"),
    redirectUri: q.get("redirect_uri"),
    responseType: q.get("response_type"),
    scope: q.get("scope"),
    state: q.get("state"),
    codeChallenge: q.get("code_challenge"),
    codeChallengeMethod: q.get("code_challenge_method"),
    resource: q.get("resource"),
  });

  if (!result.ok) {
    if (result.kind === "page") return errorPage(result.message);
    return NextResponse.redirect(
      buildAuthorizationRedirect(result.redirectUri, {
        error: result.error,
        error_description: result.description,
        state: result.state,
      }),
      303
    );
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    const login = new URL("/login", request.nextUrl.origin);
    login.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login, 303);
  }

  const requestId = await createAuthorizationRequest(prisma, {
    clientRefId: result.client.id,
    userId,
    redirectUri: result.redirectUri,
    scopes: result.scopes,
    state: result.state,
    codeChallenge: result.codeChallenge,
    resource: result.resource,
  });
  const consent = new URL("/oauth/consent", request.nextUrl.origin);
  consent.searchParams.set("request", requestId);
  return NextResponse.redirect(consent, 303);
}
