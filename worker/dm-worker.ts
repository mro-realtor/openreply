import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import os from "node:os";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { maintainInstagramAccounts } from "@/lib/instagram/maintenance";
import { liveMetaOps } from "@/lib/instagram/meta-ops";

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);

// Instagram connection upkeep (token renewal, webhook recovery). Runs here
// because self-hosted deployments have no Vercel cron. The cron route does the
// same work and the two are safe together: each account is locked while handled.
const IG_MAINTENANCE_ENABLED = process.env.IG_MAINTENANCE_ENABLED !== "false";
const IG_MAINTENANCE_INTERVAL_MS = Number(
  process.env.IG_MAINTENANCE_INTERVAL_MS ?? 6 * 3_600_000
);

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

if (IG_MAINTENANCE_ENABLED) {
  setTimeout(() => void maintainInstagram(), 60_000);
}
const maintenanceTimer = IG_MAINTENANCE_ENABLED
  ? setInterval(() => void maintainInstagram(), IG_MAINTENANCE_INTERVAL_MS)
  : null;

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
