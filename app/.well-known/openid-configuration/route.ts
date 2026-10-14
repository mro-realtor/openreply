import { getAuthorizationServerMetadata, isOAuthEnabled } from "@/lib/oauth/config";
import { CORS_HEADERS, corsPreflight, notFoundResponse } from "@/lib/oauth/errors";

export const dynamic = "force-dynamic";

/**
 * Some clients probe this path as a fallback. It returns the same OAuth 2.0
 * metadata; OpenReply is not an OpenID Connect provider and issues no ID tokens.
 */
export async function GET() {
  if (!isOAuthEnabled()) return notFoundResponse();
  return Response.json(getAuthorizationServerMetadata(), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export const OPTIONS = corsPreflight;
