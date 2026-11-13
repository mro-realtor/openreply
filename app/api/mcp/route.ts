import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateBearer } from "@/lib/api/auth";
import { ApiError, errorBody } from "@/lib/api/errors";
import { assertMcpEnabled } from "@/lib/api/flags";
import { redactString } from "@/lib/api/redact";
import { redisRateLimitStore } from "@/lib/api/redis-rate-limit-store";
import { prisma } from "@/lib/db/client";
import { createMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error: ApiError, requestId: string) {
  return Response.json(errorBody(error, requestId), {
    status: error.status,
    headers: { ...NO_STORE, "X-Request-Id": requestId, ...error.headers },
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
    if (error instanceof ApiError) return errorResponse(error, requestId);
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
