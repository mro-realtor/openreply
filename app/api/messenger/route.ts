import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { encryptToken, decryptToken } from "@/lib/meta/oauth";
import { getMetaGraphApiVersion } from "@/lib/env";
import { isInstagramWindowOpen } from "@/lib/sequences/rules";

const connect = z.object({ token: z.string().trim().min(1).max(4096) });
const reply = z.object({ pageId: z.string(), recipientId: z.string(), text: z.string().trim().min(1).max(2000) });

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const pages = await prisma.messengerPage.findMany({
    where: { workspaceId: context.workspaceId },
    select: { id: true, name: true, events: { take: 50, orderBy: { receivedAt: "desc" } } },
  });
  return NextResponse.json({ pages, editable: canManageWorkspace(context.role) });
}

export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) return NextResponse.json({ error: "Administrator required" }, { status: 403 });
  const input = connect.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Page access token required" }, { status: 400 });
  const headers = { Authorization: `Bearer ${input.data.token}` };
  const base = `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
  try {
    const response = await fetch(`${base}/me?fields=id,name,category`, { headers, cache: "no-store" });
    const page = z.object({ id: z.string().regex(/^\d+$/), name: z.string(), category: z.string() }).safeParse(await response.json());
    if (!response.ok || !page.success) return NextResponse.json({ error: "Meta did not accept this Facebook Page access token" }, { status: 400 });
    const { id, name } = page.data;
    const accessToken = encryptToken(input.data.token);
    await prisma.messengerPage.createMany({ data: [{ id, name, accessToken, workspaceId: context.workspaceId }], skipDuplicates: true });
    const saved = await prisma.messengerPage.updateMany({
      where: { id, workspaceId: context.workspaceId }, data: { name, accessToken },
    });
    if (!saved.count) return NextResponse.json({ error: "This Page is already connected to another workspace" }, { status: 409 });
    return NextResponse.json({ id, name });
  } catch {
    return NextResponse.json({ error: "Unable to verify or save this Page" }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) return NextResponse.json({ error: "Administrator required" }, { status: 403 });
  const input = reply.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "A Page, contact, and message are required" }, { status: 400 });
  const { pageId, recipientId, text } = input.data;
  const page = await prisma.messengerPage.findFirst({ where: { id: pageId, workspaceId: context.workspaceId } });
  if (!page) return NextResponse.json({ error: "Page unavailable" }, { status: 404 });
  const inbound = await prisma.messengerEvent.findFirst({
    where: { pageId, recipientId, kind: "MESSAGE" }, orderBy: { receivedAt: "desc" },
  });
  if (!isInstagramWindowOpen(inbound?.receivedAt.getTime(), Date.now())) {
    return NextResponse.json({ error: "The contact needs to message this Page within 24 hours." }, { status: 409 });
  }
  try {
    const response = await fetch(`https://graph.facebook.com/${getMetaGraphApiVersion()}/${pageId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${decryptToken(page.accessToken)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } }),
    });
    if (!response.ok) return NextResponse.json({ error: "Meta rejected the send. Check Page permissions and the token." }, { status: 502 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Delivery could not be confirmed" }, { status: 502 });
  }
}
