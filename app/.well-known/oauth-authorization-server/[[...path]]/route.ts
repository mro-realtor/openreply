import { getAuthorizationServerMetadata, isOAuthEnabled } from "@/lib/oauth/config";
import { CORS_HEADERS, corsPreflight, notFoundResponse } from "@/lib/oauth/errors";

export const dynamic = "force-dynamic";

/** RFC 8414 authorization server metadata. */
export async function GET() {
  if (!isOAuthEnabled()) return notFoundResponse();
  return Response.json(getAuthorizationServerMetadata(), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export const OPTIONS = corsPreflight;
