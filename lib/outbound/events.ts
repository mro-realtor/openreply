import type { PrismaClient } from "@/app/generated/prisma/client";
import { sanitizeError } from "@/lib/instagram/health";
import { isOutboundWebhooksEnabled, type OutboundEventType } from "./config";

type Db = PrismaClient;

export interface EmitInput {
  workspaceId: string;
  type: OutboundEventType;
  /** Same key twice means the second call is ignored (safe to call from retried jobs). */
  dedupeKey: string;
  data: Record<string, unknown>;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Records the event and queues one delivery per active endpoint that listens
 * for it (an empty event list means "everything except ping"). Event and
 * deliveries are written in one transaction, so an event is never half queued.
 */
export async function emitEvent(db: Db, input: EmitInput): Promise<{ created: boolean; deliveries: number }> {
  try {
    return await db.$transaction(async (tx) => {
      const event = await tx.outboxEvent.create({
        data: {
          workspaceId: input.workspaceId,
          type: input.type,
          dedupeKey: input.dedupeKey,
          payload: input.data as object,
        },
        select: { id: true },
      });
      const endpoints = await tx.webhookEndpoint.findMany({
        where: { workspaceId: input.workspaceId, isActive: true },
        select: { id: true, eventTypes: true },
      });
      const targets = endpoints.filter((e) =>
        e.eventTypes.length === 0 ? input.type !== "ping" : e.eventTypes.includes(input.type)
      );
      if (targets.length > 0) {
        await tx.webhookDelivery.createMany({
          data: targets.map((e) => ({ endpointId: e.id, eventId: event.id })),
          skipDuplicates: true,
        });
      }
      return { created: true, deliveries: targets.length };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { created: false, deliveries: 0 };
    throw err;
  }
}

/** Queues a test event for ONE endpoint, whatever its event list says. */
export async function emitPing(db: Db, endpoint: { id: string; workspaceId: string }): Promise<string> {
  return db.$transaction(async (tx) => {
    const event = await tx.outboxEvent.create({
      data: {
        workspaceId: endpoint.workspaceId,
        type: "ping",
        dedupeKey: `ping:${endpoint.id}:${Date.now()}`,
        payload: { message: "Test event from OpenReply" },
      },
      select: { id: true },
    });
    const delivery = await tx.webhookDelivery.create({
      data: { endpointId: endpoint.id, eventId: event.id },
      select: { id: true },
    });
    return delivery.id;
  });
}

/**
 * Fire-and-forget wrapper for product code (workers, services). Does nothing
 * when the feature is off and never throws, so a webhook problem can never
 * break sending a DM or saving a contact.
 */
export async function emitOutbound(db: Db, input: EmitInput): Promise<void> {
  if (!isOutboundWebhooksEnabled()) return;
  try {
    await emitEvent(db, input);
  } catch (err) {
    console.error("outbound emit failed", sanitizeError(err instanceof Error ? err.message : String(err)));
  }
}

const DM_STATUS_TO_EVENT: Partial<Record<string, OutboundEventType>> = {
  SENT: "dm.sent",
  FAILED: "dm.failed",
  SKIPPED_DEDUP: "dm.skipped",
  SKIPPED_RATE_LIMIT: "dm.skipped",
  SKIPPED_PLAN_LIMIT: "dm.skipped",
};

/**
 * After a comment has been processed, announce what happened to each DM log
 * for it. One event per (log, outcome); repeated calls are harmless.
 */
export async function emitDmEventsForComment(db: Db, commentId: string): Promise<void> {
  if (!isOutboundWebhooksEnabled()) return;
  try {
    const logs = await db.dmLog.findMany({
      where: { commentId, status: { in: ["SENT", "FAILED", "SKIPPED_DEDUP", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT"] } },
    });
    for (const log of logs) {
      const type = DM_STATUS_TO_EVENT[log.status];
      if (!type) continue;
      await emitOutbound(db, {
        workspaceId: log.workspaceId,
        type,
        dedupeKey: `dm:${log.id}:${log.status}`,
        data: {
          dmLogId: log.id,
          status: log.status,
          automationId: log.automationId,
          instagramAccountId: log.instagramAccountId,
          contactId: log.contactId,
          commentId: log.commentId,
          commenterId: log.commenterId,
          commenterName: log.commenterName,
          commentText: log.commentText,
          matchedKeyword: log.matchedKeyword,
          dmSentAt: log.dmSentAt ? log.dmSentAt.toISOString() : null,
          reason: log.status === "SENT" ? null : log.errorMessage ? sanitizeError(log.errorMessage).slice(0, 300) : null,
        },
      });
    }
  } catch (err) {
    console.error("outbound dm events failed", sanitizeError(err instanceof Error ? err.message : String(err)));
  }
}
