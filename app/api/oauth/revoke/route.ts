import { prisma } from "@/lib/db/client";
import { isOAuthEnabled } from "@/lib/oauth/config";
import {
  NO_STORE_HEADERS,
  CORS_HEADERS,
  OAuthError,
  corsPreflight,
  notFoundResponse,
  oauthErrorResponse,
} from "@/lib/oauth/errors";
import { limitByIp } from "@/lib/oauth/limit";
import { revokeByToken } from "@/lib/oauth/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 7009 token revocation. Revoking either token ends the whole grant. */
export async function POST(request: Request) {
  if (!isOAuthEnabled()) return notFoundResponse();
  try {
    await limitByIp(request, "revoke", 60);
    const params = new URLSearchParams(await request.text());
    await revokeByToken(prisma, {
      clientId: params.get("client_id"),
      token: params.get("token"),
    });
    return new Response(null, { status: 200, headers: { ...NO_STORE_HEADERS, ...CORS_HEADERS } });
  } catch (error) {
    if (error instanceof OAuthError) return oauthErrorResponse(error);
    return oauthErrorResponse(new OAuthError("server_error", "Revocation failed", 500));
  }
}

export const OPTIONS = corsPreflight;
