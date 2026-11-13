import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

const input = z.object({
  threadKey: z.string().min(1).max(500),
  closed: z.boolean().optional(),
  favorite: z.boolean().optional(),
  readThrough: z.iso.datetime({ offset: true }).nullable().optional(),
  assignToMe: z.boolean().optional(),
  note: z.string().trim().min(1).max(4000).optional(),
});

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const threads = await prisma.inboxThreadState.findMany({
    where: { workspaceId: context.workspaceId },
    include: { notes: { orderBy: { createdAt: "asc" }, take: 100 } },
  });
  return NextResponse.json({ threads, userId: context.userId });
}

export async function PATCH(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = input.safeParse(await request.json().catch(() => null));
  if (!result.success) return NextResponse.json({ error: "Invalid conversation update" }, { status: 400 });
  const { threadKey, assignToMe, note, ...fields } = result.data;
  const key = { workspaceId: context.workspaceId, threadKey };
  const data = {
    ...fields,
    assigneeId: assignToMe === undefined ? undefined : assignToMe ? context.userId : null,
    notes: note ? { create: { body: note, authorId: context.userId } } : undefined,
  };
  const thread = await prisma.inboxThreadState.upsert({
    where: { workspaceId_threadKey: key }, create: { ...key, ...data }, update: data,
    include: { notes: { orderBy: { createdAt: "asc" }, take: 100 } },
  });
  return NextResponse.json(thread);
}
