import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/api/audit";
import { isApiV1Enabled, isMcpEnabled } from "@/lib/api/flags";
import {
  DEFAULT_SCOPES,
  ISSUABLE_SCOPES,
  SCOPE_DEFINITIONS,
  isIssuableScope,
} from "@/lib/api/scopes";
import {
  MAX_TOKEN_LIFETIME_DAYS,
  clampLifetimeDays,
  generateApiToken,
  getTokenState,
} from "@/lib/api/tokens";
import { prisma } from "@/lib/db/client";
import { canManageBilling, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(z.string()).max(10).optional(),
    expiresInDays: z.number().int().min(1).max(MAX_TOKEN_LIFETIME_DAYS).optional(),
  })
  .strict();

const NO_STORE = { "Cache-Control": "no-store" };

// Tokens are powerful, so only the workspace owner can manage them.
async function requireOwner() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (!canManageBilling(context.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only the workspace owner can manage API tokens" },
        { status: 403 }
      ),
    };
  }
  return { context };
}

export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { context } = auth;

  const tokens = await prisma.apiToken.findMany({
    where: { workspaceId: context.workspaceId, grantId: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        tokens: tokens.map((token) => ({
          ...token,
          state: getTokenState(token),
        })),
        issuableScopes: ISSUABLE_SCOPES.map((scope) => ({
          scope,
          description: SCOPE_DEFINITIONS[scope].description,
        })),
        maxLifetimeDays: MAX_TOKEN_LIFETIME_DAYS,
        features: { api: isApiV1Enabled(), mcp: isMcpEnabled() },
      },
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { context } = auth;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const requested = parsed.data.scopes?.length ? parsed.data.scopes : DEFAULT_SCOPES;
  const rejected = requested.filter((scope) => !isIssuableScope(scope));
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `These scopes cannot be issued yet: ${rejected.join(", ")}`,
      },
      { status: 400 }
    );
  }
  const scopes = Array.from(new Set(requested));

  const generated = generateApiToken();
  const lifetimeDays = clampLifetimeDays(parsed.data.expiresInDays);
  const expiresAt = new Date(Date.now() + lifetimeDays * 86_400_000);

  const record = await prisma.apiToken.create({
    data: {
      workspaceId: context.workspaceId,
      createdByUserId: context.userId,
      name: parsed.data.name,
      tokenPrefix: generated.displayPrefix,
      tokenHash: generated.hash,
      scopes,
      expiresAt,
    },
    select: { id: true, name: true, tokenPrefix: true, scopes: true, expiresAt: true },
  });

  await recordAudit(prisma, {
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    apiTokenId: record.id,
    channel: "DASHBOARD",
    action: "api_token.create",
    targetType: "ApiToken",
    targetId: record.id,
    outcome: "SUCCESS",
    details: { name: record.name, scopes, expiresAt: expiresAt.toISOString() },
  });

  // The only time the secret leaves the server.
  return NextResponse.json(
    { success: true, data: { ...record, secret: generated.secret } },
    { status: 201, headers: NO_STORE }
  );
}

export async function DELETE(request: NextRequest) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { context } = auth;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing token ID" },
      { status: 400 }
    );
  }

  const result = await prisma.apiToken.updateMany({
    where: { id, workspaceId: context.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { success: false, error: "Token not found or already revoked" },
      { status: 404 }
    );
  }

  await recordAudit(prisma, {
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    apiTokenId: id,
    channel: "DASHBOARD",
    action: "api_token.revoke",
    targetType: "ApiToken",
    targetId: id,
    outcome: "SUCCESS",
  });

  return NextResponse.json({ success: true, data: { revoked: true } });
}
