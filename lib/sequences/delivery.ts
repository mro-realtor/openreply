import { prisma } from "@/lib/db/client";
import { releaseWorkspaceDMReservation, reserveWorkspaceDMSend } from "@/lib/billing/usage";
import { sendDirectMessage, sendDirectMessageWithLinkButton, sendDirectMessageWithQuickReplies } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import { resolveSequenceRoute, validateSequenceGraph } from "./graph";
import { isInstagramWindowOpen, sequenceSteps } from "./rules";

type EnrollmentTarget = {
  id: string | null;
  workspaceId: string;
  instagramAccountId: string;
  sequenceId: string | null;
};

export async function enrollInSequence(
  campaign: EnrollmentTarget,
  recipientId: string,
  recipientName: string | null,
  interactionAt?: number
) {
  const now = Date.now();
  if (!campaign.sequenceId || interactionAt === undefined || !isInstagramWindowOpen(interactionAt, now)) return;

  const sequence = await prisma.sequence.findFirst({
    where: { id: campaign.sequenceId, workspaceId: campaign.workspaceId, enabled: true },
    select: { id: true, steps: true },
  });
  if (!sequence) return;

  const steps = sequenceSteps.parse(sequence.steps);
  return prisma.sequenceEnrollment.createMany({
    data: [{
      sequenceId: sequence.id,
      automationId: campaign.id,
      instagramAccountId: campaign.instagramAccountId,
      recipientId,
      recipientName,
      interactionAt: new Date(interactionAt),
      dueAt: new Date(now + steps[0].delayMinutes * 60_000),
      steps,
    }],
    skipDuplicates: true,
  });
}

export async function cancelOnReply(instagramId: string, recipientId: string, interactionAt?: number, exceptIds: string[] = []) {
  if (interactionAt === undefined || !isInstagramWindowOpen(interactionAt, Date.now())) return;
  await prisma.sequenceEnrollment.updateMany({
    where: {
      account: { instagramId },
      recipientId,
      ...(exceptIds.length ? { id: { notIn: exceptIds } } : {}),
      interactionAt: { lt: new Date(interactionAt) },
      status: { in: ["PENDING", "SENDING", "WAITING"] },
    },
    data: { status: "CANCELLED", reason: "Contact replied" },
  });
}

const QUICK_REPLY_PREFIX = "sequence:";

export async function routeSequenceQuickReply(
  instagramId: string,
  recipientId: string,
  payload: string,
  interactionAt: number,
): Promise<string[]> {
  if (!payload.startsWith(QUICK_REPLY_PREFIX) || !isInstagramWindowOpen(interactionAt, Date.now())) return [];
  const waiting = await prisma.sequenceEnrollment.findMany({
    where: { account: { instagramId }, recipientId, status: "WAITING" },
    select: { id: true, sequenceId: true, nextStep: true, steps: true },
  });
  const routed: string[] = [];
  for (const enrollment of waiting) {
    const steps = sequenceSteps.safeParse(enrollment.steps);
    if (!steps.success) continue;
    const step = steps.data[enrollment.nextStep];
    if (!step?.id || !step.quickReplies?.length) continue;
    const reply = step.quickReplies.find((item) =>
      payload === `sequence:${enrollment.sequenceId}:step:${step.id}:reply:${item.id}`
    );
    if (!reply) continue;
    const targetIndex = resolveSequenceRoute(steps.data, enrollment.nextStep, `quickReply:${reply.id}`);
    const target = targetIndex === null ? undefined : steps.data[targetIndex];
    const update = await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollment.id, nextStep: enrollment.nextStep, status: "WAITING" },
      data: {
        status: target ? "PENDING" : "COMPLETED",
        nextStep: targetIndex ?? enrollment.nextStep,
        dueAt: new Date(interactionAt + (target?.delayMinutes ?? 0) * 60_000),
        interactionAt: new Date(interactionAt),
        reason: null,
      },
    });
    if (update.count) routed.push(enrollment.id);
  }
  return routed;
}

async function deliverStep(id: string) {
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id },
    include: { sequence: true, automation: true, account: true },
  });
  if (!enrollment || enrollment.status !== "PENDING") return;

  const { automation, sequence, nextStep, recipientId, recipientName } = enrollment;
  const finish = (status: "CANCELLED" | "EXPIRED" | "FAILED", reason: string) =>
    prisma.sequenceEnrollment.updateMany({
      where: { id, nextStep, status: { in: ["PENDING", "SENDING", "WAITING"] } },
      data: { status, reason },
    });

  if (!sequence.enabled || (automation && (!automation.isActive || automation.sequenceId !== sequence.id))) {
    await finish("CANCELLED", "Sequence or campaign is inactive");
    return;
  }
  if (!isInstagramWindowOpen(enrollment.interactionAt.getTime(), Date.now())) {
    await finish("EXPIRED", "Instagram messaging window closed");
    return;
  }

  const steps = sequenceSteps.parse(enrollment.steps);
  validateSequenceGraph(steps);
  const step = steps[nextStep];
  const account = enrollment.account;
  if (!step || !account.accessToken) {
    await finish("FAILED", "Missing message or Instagram connection");
    return;
  }

  const claim = await prisma.sequenceEnrollment.updateMany({
    where: { id, nextStep, status: "PENDING" },
    data: { status: "SENDING" },
  });
  if (!claim.count) return;

  try {
    const token = decryptToken(account.accessToken);
    const usage = await reserveWorkspaceDMSend(sequence.workspaceId);
    if (!usage.allowed) {
      await finish("FAILED", "Workspace DM limit reached");
      return;
    }

    if (!isInstagramWindowOpen(enrollment.interactionAt.getTime(), Date.now())) {
      await releaseWorkspaceDMReservation(sequence.workspaceId, usage.periodStart);
      await finish("EXPIRED", "Instagram messaging window closed");
      return;
    }

    const stillSending = await prisma.sequenceEnrollment.findFirst({
      where: {
        id,
        status: "SENDING",
        sequence: { enabled: true },
        ...(automation ? { automation: { isActive: true, sequenceId: sequence.id } } : {}),
      },
      select: { id: true },
    });
    if (!stillSending) {
      await releaseWorkspaceDMReservation(sequence.workspaceId, usage.periodStart);
      await finish("CANCELLED", "Sequence or campaign was stopped");
      return;
    }

    const message = renderMessageWithoutLink({ message: step.message, commenterName: recipientName });
    if (step.quickReplies?.length) {
      const waiting = await prisma.sequenceEnrollment.updateMany({
        where: { id, status: "SENDING", nextStep },
        data: { status: "WAITING", nextStep },
      });
      if (!waiting.count) {
        await releaseWorkspaceDMReservation(sequence.workspaceId, usage.periodStart);
        return;
      }
      await sendDirectMessageWithQuickReplies(token, account.instagramId, recipientId, message,
        step.quickReplies.map((reply) => ({
          title: reply.title,
          payload: `sequence:${sequence.id}:step:${step.id}:reply:${reply.id}`,
        })));
      return;
    } else if (step.buttons?.length) {
      await sendDirectMessageWithLinkButton(token, account.instagramId, recipientId, message, step.buttons);
    } else {
      await sendDirectMessage(token, account.instagramId, recipientId, message);
    }
  } catch (error) {
    // A lost response can mean Meta accepted the message. Do not send it twice.
    await finish("FAILED", error instanceof Error ? error.message.slice(0, 300) : "Delivery failed");
    return;
  }

  const followingIndex = resolveSequenceRoute(steps, nextStep, "next");
  const following = followingIndex === null ? undefined : steps[followingIndex];
  await prisma.sequenceEnrollment.updateMany({
    where: { id, status: "SENDING", nextStep },
    data: {
      nextStep: followingIndex ?? nextStep,
      status: following ? "PENDING" : "COMPLETED",
      dueAt: new Date(Date.now() + (following?.delayMinutes ?? 0) * 60_000),
    },
  });
}

export async function deliverDueSequenceSteps() {
  await prisma.sequenceEnrollment.updateMany({
    where: { status: "WAITING", interactionAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
    data: { status: "EXPIRED", reason: "Instagram messaging window closed" },
  });
  await prisma.sequenceEnrollment.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: "FAILED", reason: "Delivery could not be confirmed" },
  });
  const due = await prisma.sequenceEnrollment.findMany({
    where: { status: "PENDING", dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" },
    take: 25,
    select: { id: true },
  });
  for (const { id } of due) await deliverStep(id);
}
