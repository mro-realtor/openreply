import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contacts = await prisma.contact.findMany({
    where: { instagramAccount: { workspaceId: context.workspaceId } },
    include: { instagramAccount: { select: { username: true, name: true } } },
    orderBy: [{ lastInteractionAt: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  return NextResponse.json({ contacts });
}
