import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { CONNECTION_SELECT, toConnectionView, type ConnectionRow } from "@/lib/instagram/view";

export const runtime = "nodejs";

/** Per-account connection health for the Settings page. Never returns tokens. */
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const rows = (await prisma.instagramAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "asc" },
    select: CONNECTION_SELECT,
  })) as unknown as ConnectionRow[];

  const userIds = [...new Set(rows.map((r) => r.connectedByUserId).filter((v): v is string => Boolean(v)))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, workspaceMembers: { some: { workspaceId } } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email ?? null]));

  const now = new Date();
  return NextResponse.json({
    success: true,
    data: {
      accounts: rows.map((r) => toConnectionView(r, r.connectedByUserId ? nameOf.get(r.connectedByUserId) ?? null : null, now)),
    },
  });
}
