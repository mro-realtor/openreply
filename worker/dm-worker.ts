import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import os from "node:os";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { maintainInstagramAccounts } from "@/lib/instagram/maintenance";
import { liveMetaOps } from "@/lib/instagram/meta-ops";
import { startInstagramMaintenance } from "@/lib/instagram/scheduler";
import { startCommentPolling } from "@/lib/polling/scheduler";
import { isOutboundWebhooksEnabled } from "@/lib/outbound/config";
import { deliverDue, liveSender } from "@/lib/outbound/deliver";

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. It contacts Meta and can
// queue messages for active campaigns, so it is opt-in: it only runs when
// COMMENT_POLLING_ENABLED is exactly "true". See lib/polling/scheduler.ts.

// Instagram connection upkeep (token renewal, webhook recovery) contacts Meta, so
// it is opt-in: it only runs when IG_MAINTENANCE_ENABLED is exactly "true".
// See lib/instagram/scheduler.ts.

// Outbound webhooks (n8n, CRM). Sends queued events with retries. Does nothing
// unless OUTBOUND_WEBHOOKS_ENABLED=true.
const OUTBOUND_INTERVAL_MS = Number(process.env.OUTBOUND_DELIVERY_INTERVAL_MS ?? 15_000);
let outboundRunning = false;

console.log("[DM Worker] Started");

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

async function maintainInstagram() {
  try {
    const results = await maintainInstagramAccounts(prisma, liveMetaOps, {
      decrypt: decryptToken,
      encrypt: encryptToken,
    });
    const refreshed = results.filter((r) => r.refresh === "refreshed").length;
    const needsAttention = results.filter((r) => r.status !== "ACTIVE").length;
    console.log(
      `[DM Worker] Instagram maintenance: ${results.length} accounts, ${refreshed} renewed, ${needsAttention} need attention`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Instagram maintenance failed:", message);
  }
}

const maintenance = startInstagramMaintenance(maintainInstagram, {
  log: (message) => console.log(`[DM Worker] ${message}`),
});

async function deliverWebhooks() {
  if (outboundRunning || !isOutboundWebhooksEnabled()) return;
  outboundRunning = true;
  try {
    const summary = await deliverDue(prisma, liveSender, { decrypt: decryptToken });
    if (summary.attempted > 0) {
      console.log(
        `[DM Worker] Webhooks: ${summary.attempted} tried, ${summary.delivered} delivered, ${summary.retrying} retrying, ${summary.dead} dead`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Webhook delivery failed:", message);
  } finally {
    outboundRunning = false;
  }
}

const outboundTimer = setInterval(() => void deliverWebhooks(), OUTBOUND_INTERVAL_MS);

const polling = startCommentPolling(poll, {
  log: (message) => console.log(`[DM Worker] ${message}`),
});

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  polling?.stop();
  maintenance?.stop();
  clearInterval(outboundTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
