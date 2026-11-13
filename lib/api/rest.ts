import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/api/audit";
import { authenticateBearer, requireScope } from "@/lib/api/auth";
import { ApiError, errorBody } from "@/lib/api/errors";
import { assertApiEnabled } from "@/lib/api/flags";
import { redactString } from "@/lib/api/redact";
import { redisRateLimitStore } from "@/lib/api/redis-rate-limit-store";
import type { Scope } from "@/lib/api/scopes";
import type { ApiContext } from "@/lib/api/types";
import { prisma } from "@/lib/db/client";

const BASE_HEADERS = { "Cache-Control": "no-store" };

export function jsonOk(
  data: unknown,
  requestId: string,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return NextResponse.json(
    { data, requestId },
    {
      status: init.status ?? 200,
      headers: { ...BASE_HEADERS, "X-Request-Id": requestId, ...init.headers },
    }
  );
}

function jsonError(error: ApiError, requestId: string) {
  return NextResponse.json(errorBody(error, requestId), {
    status: error.status,
    headers: { ...BASE_HEADERS, "X-Request-Id": requestId, ...error.headers },
  });
}

/**
 * Wraps a /api/v1 handler with feature flag, bearer auth, rate limiting,
 * scope check, structured errors and denial auditing.
 */
export async function runV1(
  request: Request,
  scope: Scope,
  handler: (ctx: ApiContext, requestId: string) => Promise<Response>
): Promise<Response> {
  const requestId = crypto.randomUUID();
  let ctx: ApiContext | null = null;
  try {
    assertApiEnabled();
    ctx = await authenticateBearer(
      prisma,
      request.headers.get("authorization"),
      { rateLimitStore: redisRateLimitStore }
    );
    requireScope(ctx, scope);
    return await handler(ctx, requestId);
  } catch (error) {
    if (error instanceof ApiError) {
      if (ctx && error.code === "FORBIDDEN") {
        await recordAudit(prisma, {
          workspaceId: ctx.workspaceId,
          apiTokenId: ctx.tokenId,
          actorUserId: ctx.createdByUserId,
          channel: "REST",
          action: `${request.method} ${new URL(request.url).pathname}`,
          outcome: "DENIED",
          details: { requiredScope: scope },
        });
      }
      return jsonError(error, requestId);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[api/v1] ${requestId} unhandled: ${redactString(message)}`);
    return jsonError(
      new ApiError("INTERNAL", 500, "Internal server error"),
      requestId
    );
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("VALIDATION_FAILED", 400, "Request body must be valid JSON");
  }
}
