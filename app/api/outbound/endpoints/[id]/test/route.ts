import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireOutboundManager } from "@/lib/outbound/access";
import { emitPing } from "@/lib/outbound/events";

export const runtime = "nodejs";
type RouteProps = { params: Promise<{ id: string }> };

/** Queues one test event. The worker sends it within seconds; check the deliveries list for the result. */
export async function POST(_request: Request, { params }: RouteProps) {
  const gate = await requireOutboundManager();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id, workspaceId: gate.workspaceId },
    select: { id: true, workspaceId: true, isActive: true },
  });
  if (!endpoint) return NextResponse.json({ success: false, error: "Endpoint not found" }, { status: 404 });
  if (!endpoint.isActive) {
    return NextResponse.json({ success: false, error: "Endpoint is switched off" }, { status: 409 });
  }
  const deliveryId = await emitPing(prisma, endpoint);
  return NextResponse.json({ success: true, data: { deliveryId } }, { status: 202 });
}
