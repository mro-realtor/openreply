import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateBearer } from "@/lib/api/auth";
import { ApiError, errorBody } from "@/lib/api/errors";
import { assertMcpEnabled } from "@/lib/api/flags";
import { redactString } from "@/lib/api/redact";
import { redisRateLimitStore } from "@/lib/api/redis-rate-limit-store";
import { prisma } from "@/lib/db/client";
import { createMcpServer } from "@/lib/mcp/server";
import { getResourceMetadataUrl, isOAuthEnabled } from "@/lib/oauth/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * MCP authorization discovery: a 401 must point the client at the protected
 * resource metadata so it can find the authorization server (RFC 9728).
 * Bearer tokens keep working exactly as before; this only adds a hint.
 */
function challengeFor(request: Request): Record<string, string> {
  if (!isOAuthEnabled()) return {};
  const parts = ['realm="openreply"', `resource_metadata="${getResourceMetadataUrl()}"`];
  if (request.headers.get("authorization")) parts.push('error="invalid_token"');
  return { "WWW-Authenticate": `Bearer ${parts.join(", ")}` };
}

function errorResponse(error: ApiError, requestId: string, request?: Request) {
  const challenge = error.status === 401 && request ? challengeFor(request) : {};
  return Response.json(errorBody(error, requestId), {
    status: error.status,
    headers: { ...NO_STORE, "X-Request-Id": requestId, ...error.headers, ...challenge },
  });
}

/**
 * Remote MCP endpoint (Streamable HTTP, stateless, JSON responses).
 * Requires `Authorization: Bearer orp_...` on every request. There is no
 * anonymous access, not even to list tools.
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertMcpEnabled();
    const ctx = await authenticateBearer(
      prisma,
      request.headers.get("authorization"),
      { rateLimitStore: redisRateLimitStore }
    );

    const server = createMcpServer(prisma, ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error, requestId, request);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[mcp] ${requestId} unhandled: ${redactString(message)}`);
    return errorResponse(new ApiError("INTERNAL", 500, "Internal server error"), requestId);
  }
}

// Stateless server: no server-initiated streams and no sessions to close.
function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...NO_STORE } });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
