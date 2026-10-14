import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireOutboundManager } from "@/lib/outbound/access";
import { replayDelivery } from "@/lib/outbound/endpoints";

export const runtime = "nodejs";
type RouteProps = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteProps) {
  const gate = await requireOutboundManager();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const ok = await replayDelivery(prisma, gate.workspaceId, id);
  if (!ok) return NextResponse.json({ success: false, error: "Delivery not found" }, { status: 404 });
  return NextResponse.json({ success: true }, { status: 202 });
}
