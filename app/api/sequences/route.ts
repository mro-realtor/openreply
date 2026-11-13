import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { sequenceInput } from "@/lib/sequences/rules";

const saveInput = sequenceInput.safeExtend({ id: z.string().min(1).optional() });
const cancelInput = z.object({ sequenceId: z.string().min(1), enrollmentId: z.string().min(1) });

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const where = { workspaceId: context.workspaceId };
  const [sequences, campaigns] = await Promise.all([
    prisma.sequence.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { enrollments: true } },
        enrollments: {
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: {
            id: true, recipientName: true, status: true, nextStep: true,
            reason: true, dueAt: true, automation: { select: { name: true } },
          },
        },
      },
    }),
    prisma.automation.findMany({
      where,
      orderBy: { name: "asc" },
      select: { id: true, name: true, sequenceId: true, isActive: true, dmTriggerEnabled: true, keywords: true, matchAnyWord: true },
    }),
  ]);

  return NextResponse.json({ sequences, campaigns, editable: canManageWorkspace(context.role) });
}

class AssignmentConflict extends Error {}

export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) {
    return NextResponse.json({ error: "Workspace administrator required" }, { status: 403 });
  }

  const input = saveInput.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: input.error.issues[0].message }, { status: 400 });
  }

  const { id, name, steps, enabled = false, campaignIds = [] } = input.data;
  const workspaceId = context.workspaceId;

  try {
    const sequence = await prisma.$transaction(async (tx) => {
      const data = { name, steps, enabled };
      const saved = id
        ? await tx.sequence.updateMany({ where: { id, workspaceId }, data })
            .then((result) => result.count ? { id } : null)
        : await tx.sequence.create({ data: { ...data, workspaceId }, select: { id: true } });
      if (!saved) return null;

      await tx.automation.updateMany({
        where: { workspaceId, sequenceId: saved.id, id: { notIn: campaignIds } },
        data: { sequenceId: null },
      });
      const assigned = await tx.automation.updateMany({
        where: {
          workspaceId,
          id: { in: campaignIds },
          OR: [{ sequenceId: null }, { sequenceId: saved.id }],
        },
        data: { sequenceId: saved.id },
      });
      if (assigned.count !== new Set(campaignIds).size) throw new AssignmentConflict();

      await tx.sequenceEnrollment.updateMany({
        where: {
          sequenceId: saved.id,
          status: { in: ["PENDING", "SENDING"] },
          ...(enabled ? { automationId: { not: null, notIn: campaignIds } } : {}),
        },
        data: { status: "CANCELLED", reason: enabled ? "Campaign detached" : "Sequence disabled" },
      });

      return saved;
    });

    return sequence
      ? NextResponse.json(sequence)
      : NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  } catch (error) {
    if (!(error instanceof AssignmentConflict)) throw error;
    return NextResponse.json({ error: "A selected campaign is unavailable or already assigned" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context || !canManageWorkspace(context.role)) {
    return NextResponse.json({ error: "Workspace administrator required" }, { status: 403 });
  }

  const input = cancelInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid enrollment" }, { status: 400 });

  const result = await prisma.sequenceEnrollment.updateMany({
    where: {
      id: input.data.enrollmentId,
      sequenceId: input.data.sequenceId,
      sequence: { workspaceId: context.workspaceId },
      status: { in: ["PENDING", "SENDING"] },
    },
    data: { status: "CANCELLED", reason: "Stopped by workspace administrator" },
  });

  return result.count
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "Enrollment is no longer pending" }, { status: 409 });
}
