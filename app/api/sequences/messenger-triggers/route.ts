import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

const input = z.object({ sequenceId: z.string().min(1), pageId: z.string().regex(/^\d+$/), keywords: z.array(z.string().trim().min(1).max(50)).min(1).max(10), reply: z.string().trim().min(1).max(1000) });
export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) return NextResponse.json({ error: "Workspace administrator required" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a Page, keywords, and a reply." }, { status: 400 });
  const value = parsed.data;
  const [page, sequence] = await Promise.all([
    prisma.messengerPage.findFirst({ where: { id: value.pageId, workspaceId: context.workspaceId } }),
    prisma.sequence.findFirst({ where: { id: value.sequenceId, workspaceId: context.workspaceId } }),
  ]);
  if (!page || !sequence) return NextResponse.json({ error: "Page or sequence unavailable." }, { status: 404 });
  if (!sequence.enabled) return NextResponse.json({ error: "Save and enable the sequence first." }, { status: 409 });
  const trigger = await prisma.messengerAutomation.create({ data: { workspaceId: context.workspaceId, pageId: page.id, sequenceId: sequence.id, name: `${sequence.name} · Messenger`, keywords: [...new Set(value.keywords)], reply: value.reply } });
  return NextResponse.json({ id: trigger.id, name: trigger.name, sequenceId: trigger.sequenceId, pageId: trigger.pageId, keywords: trigger.keywords, isActive: trigger.isActive }, { status: 201 });
}
