import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { listContactHistory } from "@/lib/contacts/manage";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";
type RouteProps = { params: Promise<{ id: string }> };

/** Campaign activity for one contact, for signed-in teammates. Read only; it never contacts anyone. */
export async function GET(request: Request, { params }: RouteProps) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sp = new URL(request.url).searchParams;
  const res = await listContactHistory(prisma, {
    workspaceId: ctx.workspaceId,
    contactId: id,
    includeContent: true,
    limit: sp.get("limit"),
    cursor: sp.get("cursor"),
  });
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, data: res.value });
}
