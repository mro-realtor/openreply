import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireOutboundManager } from "@/lib/outbound/access";

export const runtime = "nodejs";
type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteProps) {
  const gate = await requireOutboundManager();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const owned = await prisma.webhookEndpoint.findFirst({
    where: { id, workspaceId: gate.workspaceId },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ success: false, error: "Endpoint not found" }, { status: 404 });

  const rows = await prisma.webhookDelivery.findMany({
    where: { endpointId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      attempts: true,
      nextAttemptAt: true,
      lastStatusCode: true,
      lastError: true,
      deliveredAt: true,
      createdAt: true,
      event: { select: { id: true, type: true } },
    },
  });
  return NextResponse.json({ success: true, data: { deliveries: rows } });
}
