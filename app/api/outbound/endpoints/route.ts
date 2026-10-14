import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { requireOutboundManager } from "@/lib/outbound/access";
import { ENDPOINT_SELECT, createEndpoint, toEndpointView, type EndpointRow } from "@/lib/outbound/endpoints";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireOutboundManager();
  if (!gate.ok) return gate.response;
  const rows = (await prisma.webhookEndpoint.findMany({
    where: { workspaceId: gate.workspaceId },
    orderBy: { createdAt: "asc" },
    select: ENDPOINT_SELECT,
  })) as EndpointRow[];
  return NextResponse.json({ success: true, data: { endpoints: rows.map(toEndpointView) } });
}

/** The signing secret is returned here once and cannot be read again (rotate to get a new one). */
export async function POST(request: Request) {
  const gate = await requireOutboundManager();
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });

  const res = await createEndpoint(prisma, {
    workspaceId: gate.workspaceId,
    name: body.name,
    url: body.url,
    eventTypes: body.eventTypes,
    encrypt: encryptToken,
  });
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, data: res.value }, { status: 201 });
}
