import type { PrismaClient } from "@/app/generated/prisma/client";
import { sanitizeError } from "@/lib/instagram/health";
import {
  AUTO_DISABLE_AFTER,
  LOCK_MS,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  allowedPrivateHosts,
  backoffMs,
} from "./config";
import { signPayload } from "./signing";
import { assertPublicHost, validateWebhookUrl } from "./url-guard";

type Db = PrismaClient;

export interface SendRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
export type Sender = (req: SendRequest) => Promise<{ status: number }>;

/** The real network call. Redirects are never followed and private destinations are refused. */
export const liveSender: Sender = async (req) => {
  const url = new URL(req.url);
  await assertPublicHost(url, { allowedHosts: allowedPrivateHosts() });
  const res = await fetch(req.url, {
    method: "POST",
    headers: req.headers,
    body: req.body,
    redirect: "manual",
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  await res.body?.cancel().catch(() => undefined);
  return { status: res.status };
};

export type Outcome =
  | { kind: "delivered" }
  | { kind: "retry"; nextAttemptAt: Date }
  | { kind: "dead" }
  | { kind: "gone" };

/** Pure retry rules. `attemptsMade` already counts the try that just happened. */
export function decideOutcome(input: {
  statusCode: number | null;
  attemptsMade: number;
  now: Date;
}): Outcome {
  const { statusCode, attemptsMade, now } = input;
  if (statusCode !== null && statusCode >= 200 && statusCode < 300) return { kind: "delivered" };
  if (statusCode === 410) return { kind: "gone" };
  if (attemptsMade >= MAX_ATTEMPTS) return { kind: "dead" };
  return { kind: "retry", nextAttemptAt: new Date(now.getTime() + backoffMs(attemptsMade)) };
}

export interface DeliverSummary {
  attempted: number;
  delivered: number;
  retrying: number;
  dead: number;
}

/**
 * Sends every delivery that is due. Safe to run from several processes at once:
 * a delivery is claimed with a short lock before it is sent.
 */
export async function deliverDue(
  db: Db,
  sender: Sender,
  opts: { decrypt: (stored: string) => string; now?: Date; limit?: number }
): Promise<DeliverSummary> {
  const now = opts.now ?? new Date();
  const summary: DeliverSummary = { attempted: 0, delivered: 0, retrying: 0, dead: 0 };
  const due = await db.webhookDelivery.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      endpoint: { isActive: true },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: opts.limit ?? 25,
    select: { id: true },
  });

  for (const { id } of due) {
    const claim = await db.webhookDelivery.updateMany({
      where: {
        id,
        status: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    });
    if (claim.count !== 1) continue;

    const delivery = await db.webhookDelivery.findUnique({
      where: { id },
      include: { endpoint: true, event: true },
    });
    if (!delivery || !delivery.endpoint.isActive) {
      await db.webhookDelivery.updateMany({ where: { id }, data: { lockedUntil: null } });
      continue;
    }

    summary.attempted++;
    const attemptsMade = delivery.attempts + 1;
    let statusCode: number | null = null;
    let error: string | null = null;

    try {
      const check = validateWebhookUrl(delivery.endpoint.url, { allowedHosts: allowedPrivateHosts() });
      if (!check.ok) throw new Error(check.reason);
      const body = JSON.stringify({
        id: delivery.event.id,
        type: delivery.event.type,
        createdAt: delivery.event.createdAt.toISOString(),
        workspaceId: delivery.event.workspaceId,
        data: delivery.event.payload,
      });
      const ts = Math.floor(now.getTime() / 1000);
      const secret = opts.decrypt(delivery.endpoint.secretEncrypted);
      const res = await sender({
        url: delivery.endpoint.url,
        timeoutMs: REQUEST_TIMEOUT_MS,
        body,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OpenReply-Webhooks/1",
          "X-OpenReply-Signature": signPayload(secret, ts, body),
          "X-OpenReply-Event": delivery.event.type,
          "X-OpenReply-Event-Id": delivery.event.id,
          "X-OpenReply-Delivery-Id": delivery.id,
        },
      });
      statusCode = res.status;
      if (statusCode < 200 || statusCode >= 300) error = `Receiver answered HTTP ${statusCode}`;
    } catch (err) {
      error = sanitizeError(err instanceof Error ? err.message : String(err)).slice(0, 300);
    }

    const outcome = decideOutcome({ statusCode, attemptsMade, now });
    const base = { attempts: attemptsMade, lockedUntil: null, lastStatusCode: statusCode, lastError: error };

    if (outcome.kind === "delivered") {
      await db.webhookDelivery.update({
        where: { id },
        data: { ...base, status: "DELIVERED", deliveredAt: now, lastError: null },
      });
      await db.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: { consecutiveFailures: 0, lastSuccessAt: now },
      });
      summary.delivered++;
      continue;
    }

    if (outcome.kind === "gone") {
      await db.webhookDelivery.update({ where: { id }, data: { ...base, status: "DEAD" } });
      await db.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: { isActive: false, disabledReason: "The receiver answered 410 Gone", lastFailureAt: now },
      });
      summary.dead++;
      continue;
    }

    await db.webhookDelivery.update({
      where: { id },
      data:
        outcome.kind === "dead"
          ? { ...base, status: "DEAD" }
          : { ...base, status: "FAILED", nextAttemptAt: outcome.nextAttemptAt },
    });
    const endpoint = await db.webhookEndpoint.update({
      where: { id: delivery.endpointId },
      data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now },
      select: { id: true, name: true, workspaceId: true, consecutiveFailures: true, isActive: true },
    });
    if (outcome.kind === "dead") summary.dead++;
    else summary.retrying++;

    if (endpoint.isActive && endpoint.consecutiveFailures >= AUTO_DISABLE_AFTER) {
      await db.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { isActive: false, disabledReason: `Switched off after ${AUTO_DISABLE_AFTER} failed deliveries in a row` },
      });
      await db.operationalEvent.create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          workspaceId: endpoint.workspaceId,
          message: "Webhook endpoint switched off after repeated failures",
          payload: { endpointId: endpoint.id, name: endpoint.name, failures: endpoint.consecutiveFailures },
        },
      });
    }
  }
  return summary;
}
