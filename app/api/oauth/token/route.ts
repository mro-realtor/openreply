import { prisma } from "@/lib/db/client";
import { isOAuthEnabled } from "@/lib/oauth/config";
import {
  OAuthError,
  corsPreflight,
  notFoundResponse,
  oauthErrorResponse,
  oauthJson,
} from "@/lib/oauth/errors";
import { limitByIp } from "@/lib/oauth/limit";
import { exchangeAuthorizationCode, exchangeRefreshToken } from "@/lib/oauth/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readParams(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    const params = new URLSearchParams();
    if (body && typeof body === "object") {
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "string") params.set(key, value);
      }
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

export async function POST(request: Request) {
  if (!isOAuthEnabled()) return notFoundResponse();
  try {
    await limitByIp(request, "token", 60);
    const params = await readParams(request);
    const grantType = params.get("grant_type");

    // Only public clients exist. A client secret is never accepted, so a
    // client that sends one is told plainly instead of being half-authenticated.
    if (params.get("client_secret") || request.headers.get("authorization")) {
      throw new OAuthError("invalid_client", "This server only supports public clients (token_endpoint_auth_method=none)", 401);
    }

    if (grantType === "authorization_code") {
      return oauthJson(
        await exchangeAuthorizationCode(prisma, {
          clientId: params.get("client_id"),
          code: params.get("code"),
          redirectUri: params.get("redirect_uri"),
          codeVerifier: params.get("code_verifier"),
          resource: params.get("resource"),
        })
      );
    }
    if (grantType === "refresh_token") {
      return oauthJson(
        await exchangeRefreshToken(prisma, {
          clientId: params.get("client_id"),
          refreshToken: params.get("refresh_token"),
          scope: params.get("scope"),
          resource: params.get("resource"),
        })
      );
    }
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  } catch (error) {
    if (error instanceof OAuthError) return oauthErrorResponse(error);
    console.error("[oauth] token failed");
    return oauthErrorResponse(new OAuthError("server_error", "Token request failed", 500));
  }
}

export const OPTIONS = corsPreflight;
