import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { decryptToken } from "@/lib/meta/oauth";
import { getAllUserMedia } from "@/lib/meta/client";

const inputSchema = z.object({
  sequenceId: z.string().min(1),
  accountId: z.string().min(1),
  type: z.enum(["comment", "dm"]),
  postId: z.string().min(1).optional(),
  keywords: z.array(z.string().trim().min(1).max(50)).min(1).max(10),
  openingMessage: z.string().trim().min(1).max(1000).optional(),
  reply: z.string().trim().min(1).max(1000),
}).refine((input) => input.type !== "comment" || Boolean(input.postId && input.openingMessage));

export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) {
    return NextResponse.json({ error: "Workspace administrator required" }, { status: 403 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the trigger settings and keywords." }, { status: 400 });
  const input = parsed.data;
  const workspaceId = context.workspaceId;
  const [account, sequence] = await Promise.all([
    prisma.instagramAccount.findFirst({ where: { id: input.accountId, workspaceId } }),
    prisma.sequence.findFirst({ where: { id: input.sequenceId, workspaceId } }),
  ]);
  if (!account || !sequence) return NextResponse.json({ error: "Account or sequence unavailable." }, { status: 404 });

  if (!sequence.enabled) return NextResponse.json({ error: "Save and enable the sequence before activating a trigger." }, { status: 409 });

  let postUrl: string | undefined;
  if (input.type === "comment") {
    try {
      const posts = await getAllUserMedia(decryptToken(account.accessToken), 300);
      const post = posts.find((item) => item.id === input.postId);
      if (!post) return NextResponse.json({ error: "Choose a post from this account." }, { status: 400 });
      postUrl = post.permalink;
    } catch {
      return NextResponse.json({ error: "Could not verify the Instagram post." }, { status: 502 });
    }
  }
  const trigger = await prisma.automation.create({
    data: {
      workspaceId,
      instagramAccountId: account.id,
      sequenceId: sequence.id,
      name: `${sequence.name.slice(0, 65)} · ${input.type === "comment" ? "Post or Reel Comments" : "Instagram Message"}`,
      postId: input.type === "comment" ? input.postId : null,
      postUrl,
      keywords: [...new Set(input.keywords)],
      dmTriggerEnabled: input.type === "dm",
      openingDmEnabled: input.type === "comment",
      openingDmMessage: input.openingMessage,
      openingDmButtonLabel: input.type === "comment" ? "Continue" : null,
      dmMessage: input.reply,
      isActive: true,
    },
    select: { id: true, name: true, sequenceId: true, isActive: true, dmTriggerEnabled: true, keywords: true, matchAnyWord: true },
  });
  return NextResponse.json(trigger, { status: 201 });
}
