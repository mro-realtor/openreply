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
import { registerClient } from "@/lib/oauth/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 7591 Dynamic Client Registration. Public clients only (PKCE, no secret). */
export async function POST(request: Request) {
  if (!isOAuthEnabled()) return notFoundResponse();
  try {
    await limitByIp(request, "register", 10);
    const body = await request.json().catch(() => null);
    return oauthJson(await registerClient(prisma, body), 201);
  } catch (error) {
    if (error instanceof OAuthError) return oauthErrorResponse(error);
    console.error("[oauth] register failed");
    return oauthErrorResponse(new OAuthError("server_error", "Registration failed", 500));
  }
}

export const OPTIONS = corsPreflight;
