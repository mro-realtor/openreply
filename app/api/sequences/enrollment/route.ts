import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getConversationMessages } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { enrollInSequence } from "@/lib/sequences/delivery";
import { isInstagramWindowOpen } from "@/lib/sequences/rules";

const inputSchema = z.object({
  accountId: z.string().min(1),
  conversationId: z.string().min(1),
  recipientId: z.string().min(1),
  sequenceId: z.string().min(1),
});

export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) {
    return NextResponse.json({ error: "Workspace administrator required" }, { status: 403 });
  }

  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

  const { accountId, conversationId, recipientId, sequenceId } = input.data;
  const [account, sequence] = await Promise.all([
    getWorkspaceInstagramAccount(context.workspaceId, accountId),
    prisma.sequence.findFirst({ where: { id: sequenceId, workspaceId: context.workspaceId, enabled: true } }),
  ]);
  if (!account || !sequence) return NextResponse.json({ error: "Account or active sequence unavailable" }, { status: 404 });

  let messages;
  try {
    messages = await getConversationMessages(decryptToken(account.accessToken), conversationId);
  } catch {
    return NextResponse.json({ error: "Could not verify this Instagram conversation" }, { status: 502 });
  }
  const inbound = messages.find((message) => message.from?.id === recipientId &&
    message.to?.data.some((recipient) => recipient.id === account.instagramId));
  const interactionAt = Date.parse(inbound?.created_time ?? "");
  if (!isInstagramWindowOpen(interactionAt, Date.now())) {
    return NextResponse.json({ error: "The contact must message this Instagram account within the last 24 hours." }, { status: 409 });
  }

  const created = await enrollInSequence({
    id: null, workspaceId: context.workspaceId, instagramAccountId: account.id, sequenceId,
  }, recipientId, inbound?.from?.username ?? null, interactionAt);
  return created?.count
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "This contact has already been enrolled or the sequence became unavailable." }, { status: 409 });
}
