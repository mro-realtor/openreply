import { getProtectedResourceMetadata, isOAuthEnabled } from "@/lib/oauth/config";
import { CORS_HEADERS, corsPreflight, notFoundResponse } from "@/lib/oauth/errors";

export const dynamic = "force-dynamic";

/** RFC 9728 protected resource metadata. Tells a client which server issues tokens for /api/mcp. */
export async function GET() {
  if (!isOAuthEnabled()) return notFoundResponse();
  return Response.json(getProtectedResourceMetadata(), {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export const OPTIONS = corsPreflight;
