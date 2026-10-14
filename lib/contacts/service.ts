import type { PrismaClient } from "@/app/generated/prisma/client";
import { emitOutbound } from "@/lib/outbound/events";

type Db = PrismaClient;

export type DmVerdict =
  | { allow: true }
  | {
      allow: false;
      reason: "OPTED_OUT" | "HUMAN_TAKEOVER" | "ALREADY_SENT_THIS_CAMPAIGN" | "COOLDOWN";
    };

export interface ResolveInput {
  workspaceId: string;
  platform: "INSTAGRAM";
  externalId: string;
  handle?: string | null;
  displayName?: string | null;
  now?: Date;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Finds or creates the Contact behind a platform identity. Safe under
 * concurrent calls: the unique (workspace, platform, externalId) index decides
 * the winner and the loser re-reads.
 */
export async function resolveContact(db: Db, input: ResolveInput): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  const where = {
    workspaceId_platform_externalId: {
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalId: input.externalId,
    },
  };

  const touch = async (contactId: string) => {
    await db.contact.update({
      where: { id: contactId },
      data: { lastSeenAt: now, ...(input.displayName ? { displayName: input.displayName } : {}) },
    });
    if (input.handle) {
      await db.socialIdentity.update({ where, data: { handle: input.handle } });
    }
    return { id: contactId };
  };

  const existing = await db.socialIdentity.findUnique({ where });
  if (existing) return touch(existing.contactId);

  try {
    const created = await db.contact.create({
      data: {
        workspaceId: input.workspaceId,
        displayName: input.displayName ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        identities: {
          create: {
            workspaceId: input.workspaceId,
            platform: input.platform,
            externalId: input.externalId,
            handle: input.handle ?? null,
          },
        },
      },
      select: { id: true },
    });
    return created;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await db.socialIdentity.findUnique({ where });
    if (!winner) throw err;
    return touch(winner.contactId);
  }
}

/**
 * Decides whether this person may be sent a DM for this campaign right now.
 * Order matters: a stop request always wins over a dedup reason.
 */
export async function decideDm(
  db: Db,
  input: { contactId: string; automationId: string; cooldownHours: number; now?: Date }
): Promise<DmVerdict> {
  const now = input.now ?? new Date();
  const contact = await db.contact.findUnique({
    where: { id: input.contactId },
    select: { status: true, humanTakeoverAt: true, lastDmSentAt: true },
  });
  if (!contact) return { allow: true };
  if (contact.status === "OPTED_OUT") return { allow: false, reason: "OPTED_OUT" };
  if (contact.humanTakeoverAt) return { allow: false, reason: "HUMAN_TAKEOVER" };

  const sent = await db.dmLog.findFirst({
    where: { contactId: input.contactId, automationId: input.automationId, status: "SENT" },
    select: { id: true },
  });
  if (sent) return { allow: false, reason: "ALREADY_SENT_THIS_CAMPAIGN" };

  if (input.cooldownHours > 0 && contact.lastDmSentAt) {
    const until = contact.lastDmSentAt.getTime() + input.cooldownHours * 3_600_000;
    if (until > now.getTime()) return { allow: false, reason: "COOLDOWN" };
  }
  return { allow: true };
}

export async function recordDmSent(db: Db, contactId: string, at: Date = new Date()): Promise<void> {
  await db.contact.update({ where: { id: contactId }, data: { lastDmSentAt: at, lastSeenAt: at } });
}

export async function linkDmLog(
  db: Db,
  input: { automationId: string; commentId: string; contactId: string }
): Promise<"SENT" | "OTHER" | "MISSING"> {
  const log = await db.dmLog.findUnique({
    where: { automationId_commentId: { automationId: input.automationId, commentId: input.commentId } },
    select: { id: true, status: true, dmSentAt: true },
  });
  if (!log) return "MISSING";
  await db.dmLog.update({ where: { id: log.id }, data: { contactId: input.contactId } });
  if (log.status === "SENT") {
    await recordDmSent(db, input.contactId, log.dmSentAt ?? new Date());
    return "SENT";
  }
  return "OTHER";
}

export async function setOptOut(db: Db, workspaceId: string, contactId: string, optedOut: boolean) {
  const res = await db.contact.updateMany({
    where: { id: contactId, workspaceId },
    data: optedOut ? { status: "OPTED_OUT", optedOutAt: new Date() } : { status: "ACTIVE", optedOutAt: null },
  });
  if (res.count === 1 && optedOut) {
    await emitOutbound(db, {
      workspaceId,
      type: "contact.opted_out",
      dedupeKey: `contact:${contactId}:opted_out:${Date.now()}`,
      data: { contactId },
    });
  }
  return res.count === 1;
}

export async function setHumanTakeover(db: Db, workspaceId: string, contactId: string, active: boolean) {
  const res = await db.contact.updateMany({
    where: { id: contactId, workspaceId },
    data: { humanTakeoverAt: active ? new Date() : null },
  });
  if (res.count === 1 && active) {
    await emitOutbound(db, {
      workspaceId,
      type: "contact.human_takeover",
      dedupeKey: `contact:${contactId}:human_takeover:${Date.now()}`,
      data: { contactId },
    });
  }
  return res.count === 1;
}
