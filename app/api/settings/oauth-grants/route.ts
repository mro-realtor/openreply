import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/api/audit";
import { prisma } from "@/lib/db/client";
import { isOAuthEnabled } from "@/lib/oauth/config";
import { revokeGrant } from "@/lib/oauth/service";
import { canManageBilling, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function requireOwner() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canManageBilling(context.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only the workspace owner can manage connected apps" },
        { status: 403 }
      ),
    };
  }
  return { context };
}

/** Connected apps (OAuth grants) for the owner's workspace. */
export async function GET() {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { context } = auth;

  const grants = await prisma.oAuthGrant.findMany({
    where: { workspaceId: context.workspaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      scopes: true,
      createdAt: true,
      client: { select: { name: true } },
    },
  });
  const usage = await prisma.apiToken.groupBy({
    by: ["grantId"],
    where: { workspaceId: context.workspaceId, grantId: { in: grants.map((g) => g.id) } },
    _max: { lastUsedAt: true },
  });
  const lastUsed = new Map(usage.map((row) => [row.grantId, row._max.lastUsedAt]));

  return NextResponse.json(
    {
      success: true,
      data: {
        enabled: isOAuthEnabled(),
        grants: grants.map((grant) => ({
          id: grant.id,
          name: grant.client.name,
          scopes: grant.scopes,
          createdAt: grant.createdAt,
          lastUsedAt: lastUsed.get(grant.id) ?? null,
        })),
      },
    },
    { headers: NO_STORE }
  );
}

/** Disconnects an app: revokes the grant, its refresh tokens and live access tokens. */
export async function DELETE(request: NextRequest) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  const { context } = auth;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing grant ID" }, { status: 400 });
  }
  const grant = await prisma.oAuthGrant.findFirst({
    where: { id, workspaceId: context.workspaceId, revokedAt: null },
    select: { id: true },
  });
  if (!grant) {
    return NextResponse.json({ success: false, error: "Connected app not found" }, { status: 404 });
  }
  await revokeGrant(prisma, grant.id);
  await recordAudit(prisma, {
    workspaceId: context.workspaceId,
    actorUserId: context.userId,
    channel: "DASHBOARD",
    action: "oauth.grant_revoke",
    targetType: "OAuthGrant",
    targetId: grant.id,
    outcome: "SUCCESS",
  });
  return NextResponse.json({ success: true, data: { revoked: true } });
}
