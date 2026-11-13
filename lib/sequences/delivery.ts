import { prisma } from "@/lib/db/client";
import { releaseWorkspaceDMReservation, reserveWorkspaceDMSend } from "@/lib/billing/usage";
import { sendDirectMessage } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { renderMessageWithoutLink } from "@/lib/tracking/message";
import { isInstagramWindowOpen, sequenceSteps } from "./rules";

type EnrollmentTarget = {
  id: string;
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
  await prisma.sequenceEnrollment.createMany({
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

export async function cancelOnReply(instagramId: string, recipientId: string, interactionAt?: number) {
  if (interactionAt === undefined || !isInstagramWindowOpen(interactionAt, Date.now())) return;
  await prisma.sequenceEnrollment.updateMany({
    where: {
      automation: { instagramAccount: { instagramId } },
      recipientId,
      interactionAt: { lt: new Date(interactionAt) },
      status: { in: ["PENDING", "SENDING"] },
    },
    data: { status: "CANCELLED", reason: "Contact replied" },
  });
}

async function deliverStep(id: string) {
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id },
    include: { sequence: true, automation: { include: { instagramAccount: true } } },
  });
  if (!enrollment || enrollment.status !== "PENDING") return;

  const { automation, sequence, nextStep, recipientId, recipientName } = enrollment;
  const finish = (status: "CANCELLED" | "EXPIRED" | "FAILED", reason: string) =>
    prisma.sequenceEnrollment.updateMany({
      where: { id, nextStep, status: { in: ["PENDING", "SENDING"] } },
      data: { status, reason },
    });

  if (!sequence.enabled || !automation.isActive || automation.sequenceId !== sequence.id) {
    await finish("CANCELLED", "Sequence or campaign is inactive");
    return;
  }
  if (!isInstagramWindowOpen(enrollment.interactionAt.getTime(), Date.now())) {
    await finish("EXPIRED", "Instagram messaging window closed");
    return;
  }

  const steps = sequenceSteps.parse(enrollment.steps);
  const step = steps[nextStep];
  const account = automation.instagramAccount;
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
    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await finish("FAILED", "Workspace DM limit reached");
      return;
    }

    if (!isInstagramWindowOpen(enrollment.interactionAt.getTime(), Date.now())) {
      await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
      await finish("EXPIRED", "Instagram messaging window closed");
      return;
    }

    const stillSending = await prisma.sequenceEnrollment.findFirst({
      where: {
        id,
        status: "SENDING",
        sequence: { enabled: true },
        automation: { isActive: true, sequenceId: sequence.id },
      },
      select: { id: true },
    });
    if (!stillSending) {
      await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);
      await finish("CANCELLED", "Sequence or campaign was stopped");
      return;
    }

    await sendDirectMessage(token, account.instagramId, recipientId,
      renderMessageWithoutLink({ message: step.message, commenterName: recipientName })
    );
  } catch (error) {
    // A lost response can mean Meta accepted the message. Do not send it twice.
    await finish("FAILED", error instanceof Error ? error.message.slice(0, 300) : "Delivery failed");
    return;
  }

  const following = steps[nextStep + 1];
  await prisma.sequenceEnrollment.updateMany({
    where: { id, status: "SENDING", nextStep },
    data: {
      nextStep: { increment: 1 },
      status: following ? "PENDING" : "COMPLETED",
      dueAt: new Date(Date.now() + (following?.delayMinutes ?? 0) * 60_000),
    },
  });
}

export async function deliverDueSequenceSteps() {
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
