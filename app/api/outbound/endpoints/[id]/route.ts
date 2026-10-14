import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { requireOutboundManager } from "@/lib/outbound/access";
import { updateEndpoint } from "@/lib/outbound/endpoints";

export const runtime = "nodejs";
type RouteProps = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteProps) {
  const gate = await requireOutboundManager();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });

  const res = await updateEndpoint(prisma, { workspaceId: gate.workspaceId, id, patch: body, encrypt: encryptToken });
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, data: res.value });
}

export async function DELETE(_request: Request, { params }: RouteProps) {
  const gate = await requireOutboundManager();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const res = await prisma.webhookEndpoint.deleteMany({ where: { id, workspaceId: gate.workspaceId } });
  if (res.count !== 1) return NextResponse.json({ success: false, error: "Endpoint not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
