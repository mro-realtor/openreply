import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  ALERT_REPEAT_HOURS,
  DEGRADED_AFTER_FAILURES,
  backoffMs,
  classifyMetaError,
  decideRefresh,
  missingScopes,
  missingWebhookFields,
  plannedRefreshAt,
  sanitizeError,
  type ConnectionStatus,
} from "@/lib/instagram/health";

type Db = PrismaClient;

/** The only places this module touches Meta. Injected so tests never hit the network. */
export interface MetaOps {
  refreshToken(token: string): Promise<{ accessToken: string; expiresIn: number }>;
  getSubscribedFields(instagramId: string, token: string): Promise<string[]>;
  subscribe(instagramId: string, token: string): Promise<{ success: boolean }>;
}

export interface MaintenanceOptions {
  now?: Date;
  decrypt: (stored: string) => string;
  encrypt: (plain: string) => string;
  sleep?: (ms: number) => Promise<void>;
  /** In-run attempts for transient errors (1s, 3s between tries). Default 3. */
  inRunAttempts?: number;
  workspaceId?: string;
}

export interface AccountOutcome {
  accountId: string;
  username: string;
  refresh: "refreshed" | "skipped" | "failed" | "expired";
  webhook: "ok" | "restored" | "failed" | "skipped";
  status: ConnectionStatus;
}

const LOCK_MS = 10 * 60_000;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type AlertKind =
  | "NEEDS_RECONNECT"
  | "REPEATED_REFRESH_FAILURE"
  | "TOKEN_EXPIRED"
  | "MISSING_PERMISSIONS"
  | "WEBHOOK_BROKEN";

async function raiseAlert(
  db: Db,
  account: { id: string; workspaceId: string; username: string; lastAlertKind: string | null; lastAlertAt: Date | null },
  kind: AlertKind,
  detail: string,
  now: Date
): Promise<void> {
  const repeatMs = ALERT_REPEAT_HOURS * 3_600_000;
  if (account.lastAlertKind === kind && account.lastAlertAt && now.getTime() - account.lastAlertAt.getTime() < repeatMs) {
    return;
  }
  await db.operationalEvent.create({
    data: {
      workspaceId: account.workspaceId,
      source: "TOKEN_REFRESH",
      level: "ERROR",
      message: `Instagram @${account.username}: ${kind.toLowerCase().replace(/_/g, " ")}. ${detail}`,
      payload: { instagramAccountId: account.id, username: account.username, kind },
    },
  });
  await db.instagramAccount.update({ where: { id: account.id }, data: { lastAlertKind: kind, lastAlertAt: now } });
}

async function noteRecovery(db: Db, account: { id: string; workspaceId: string; username: string }, was: string) {
  await db.operationalEvent.create({
    data: {
      workspaceId: account.workspaceId,
      source: "TOKEN_REFRESH",
      level: "INFO",
      message: `Instagram @${account.username} is connected again (was ${was.toLowerCase().replace(/_/g, " ")}).`,
      payload: { instagramAccountId: account.id, username: account.username, kind: "RECOVERED" },
    },
  });
}

async function refreshWithRetries(
  ops: MetaOps,
  token: string,
  attempts: number,
  sleep: (ms: number) => Promise<void>
) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return { ok: true as const, value: await ops.refreshToken(token) };
    } catch (err) {
      last = err;
      if (classifyMetaError(err).kind !== "transient") break;
      if (i < attempts - 1) await sleep(1000 * 3 ** i);
    }
  }
  return { ok: false as const, error: last };
}

/**
 * One maintenance pass over every connected Instagram account. Each account is
 * handled with its own stored token only (never another account's or user's),
 * and one account failing never stops the others.
 */
export async function maintainInstagramAccounts(
  db: Db,
  ops: MetaOps,
  opts: MaintenanceOptions
): Promise<AccountOutcome[]> {
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? defaultSleep;
  const attempts = opts.inRunAttempts ?? 3;

  const accounts = await db.instagramAccount.findMany({
    where: { accessToken: { not: "" }, ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) },
    orderBy: [{ nextRefreshAt: "asc" }, { connectedAt: "asc" }],
  });

  const outcomes: AccountOutcome[] = [];
  for (const account of accounts) {
    const outcome: AccountOutcome = {
      accountId: account.id,
      username: account.username,
      refresh: "skipped",
      webhook: "skipped",
      status: account.connectionStatus as ConnectionStatus,
    };
    outcomes.push(outcome);

    // Claim the account so overlapping cron runs cannot refresh it twice.
    const claimed = await db.instagramAccount.updateMany({
      where: { id: account.id, OR: [{ refreshLockedUntil: null }, { refreshLockedUntil: { lt: now } }] },
      data: { refreshLockedUntil: new Date(now.getTime() + LOCK_MS) },
    });
    if (claimed.count === 0) continue;

    try {
      // Re-read after claiming: another run may have finished between our first
      // read and the claim, and acting on the stale row would refresh twice.
      const fresh = await db.instagramAccount.findUnique({ where: { id: account.id } });
      if (!fresh) continue;
      outcome.status = fresh.connectionStatus as ConnectionStatus;
      await maintainOne(db, ops, fresh, outcome, { now, sleep, attempts, decrypt: opts.decrypt, encrypt: opts.encrypt });
    } catch (err) {
      await db.instagramAccount
        .update({ where: { id: account.id }, data: { lastRefreshError: sanitizeError(err instanceof Error ? err.message : String(err)) } })
        .catch(() => {});
      outcome.refresh = outcome.refresh === "skipped" ? "failed" : outcome.refresh;
    } finally {
      await db.instagramAccount.update({ where: { id: account.id }, data: { refreshLockedUntil: null } }).catch(() => {});
    }
  }
  return outcomes;
}

type AccountRow = Awaited<ReturnType<Db["instagramAccount"]["findMany"]>>[number];

async function maintainOne(
  db: Db,
  ops: MetaOps,
  account: AccountRow,
  outcome: AccountOutcome,
  ctx: { now: Date; sleep: (ms: number) => Promise<void>; attempts: number; decrypt: (s: string) => string; encrypt: (s: string) => string }
): Promise<void> {
  const { now } = ctx;
  let status = account.connectionStatus as ConnectionStatus;
  const wasStatus = status;
  const alertInfo = { id: account.id, workspaceId: account.workspaceId, username: account.username, lastAlertKind: account.lastAlertKind, lastAlertAt: account.lastAlertAt };

  let token: string;
  try {
    token = ctx.decrypt(account.accessToken);
  } catch {
    await markNeedsReconnect(db, account, "Stored credential could not be read. Reconnect this account.");
    await raiseAlert(db, alertInfo, "NEEDS_RECONNECT", "Stored credential could not be read.", now);
    outcome.status = "NEEDS_RECONNECT";
    return;
  }

  // Permissions recorded at connect time (empty means unknown, not missing).
  const absent = account.grantedScopes.length > 0 ? missingScopes(account.grantedScopes) : [];
  if (absent.length > 0 && status === "ACTIVE") {
    status = "DEGRADED";
    await db.instagramAccount.update({
      where: { id: account.id },
      data: { connectionStatus: status, lastRefreshError: `Missing permissions: ${absent.join(", ")}. Reconnect to grant them.` },
    });
    await raiseAlert(db, alertInfo, "MISSING_PERMISSIONS", `Missing ${absent.join(", ")}.`, now);
  }

  // 1. Token refresh
  const decision = decideRefresh({
    now,
    tokenExpiresAt: account.tokenExpiresAt,
    nextRefreshAt: account.nextRefreshAt,
    lastRefreshAt: account.lastRefreshAt,
    connectedAt: account.connectedAt,
    status,
  });

  if (decision.action === "expired") {
    status = "NEEDS_RECONNECT";
    await markNeedsReconnect(db, account, "The access token expired and cannot be refreshed. Reconnect this account.");
    await raiseAlert(db, alertInfo, "TOKEN_EXPIRED", "The access token expired. The account owner must reconnect.", now);
    outcome.refresh = "expired";
  } else if (decision.action === "refresh") {
    const result = await refreshWithRetries(ops, token, ctx.attempts, ctx.sleep);
    if (result.ok) {
      const newExpiry = new Date(now.getTime() + result.value.expiresIn * 1000);
      await db.instagramAccount.update({
        where: { id: account.id },
        data: {
          accessToken: ctx.encrypt(result.value.accessToken),
          tokenExpiresAt: newExpiry,
          lastRefreshAt: now,
          nextRefreshAt: plannedRefreshAt(newExpiry),
          refreshAttempts: 0,
          lastRefreshError: absent.length > 0 ? `Missing permissions: ${absent.join(", ")}. Reconnect to grant them.` : null,
          connectionStatus: absent.length > 0 ? "DEGRADED" : "ACTIVE",
        },
      });
      token = result.value.accessToken;
      status = absent.length > 0 ? "DEGRADED" : "ACTIVE";
      outcome.refresh = "refreshed";
    } else {
      const failure = classifyMetaError(result.error);
      outcome.refresh = "failed";
      if (failure.kind === "transient") {
        const attemptsSoFar = account.refreshAttempts + 1;
        status = attemptsSoFar >= DEGRADED_AFTER_FAILURES ? "DEGRADED" : status;
        await db.instagramAccount.update({
          where: { id: account.id },
          data: {
            refreshAttempts: attemptsSoFar,
            lastRefreshError: failure.message,
            nextRefreshAt: new Date(now.getTime() + backoffMs(attemptsSoFar)),
            connectionStatus: status,
          },
        });
        if (attemptsSoFar >= DEGRADED_AFTER_FAILURES) {
          await raiseAlert(db, alertInfo, "REPEATED_REFRESH_FAILURE", `Refresh failed ${attemptsSoFar} times in a row. ${failure.message}`, now);
        }
      } else {
        status = "NEEDS_RECONNECT";
        const why =
          failure.kind === "permission"
            ? "Instagram permissions were changed or revoked. Reconnect this account."
            : "Instagram rejected the saved login. Reconnect this account.";
        await markNeedsReconnect(db, account, why, failure.message);
        await raiseAlert(db, alertInfo, "NEEDS_RECONNECT", why, now);
      }
    }
  }

  // 2. Webhook subscription (only meaningful while the login still works)
  if (status !== "NEEDS_RECONNECT") {
    try {
      let fields = await ops.getSubscribedFields(account.instagramId, token);
      let restored = false;
      if (missingWebhookFields(fields).length > 0) {
        await ops.subscribe(account.instagramId, token);
        fields = await ops.getSubscribedFields(account.instagramId, token);
        restored = true;
      }
      const stillMissing = missingWebhookFields(fields);
      await db.instagramAccount.update({
        where: { id: account.id },
        data: {
          webhookSubscribed: stillMissing.length === 0,
          webhookCheckedAt: now,
          webhookError: stillMissing.length === 0 ? null : `Missing webhook fields: ${stillMissing.join(", ")}`,
        },
      });
      if (stillMissing.length > 0) {
        outcome.webhook = "failed";
        await raiseAlert(db, alertInfo, "WEBHOOK_BROKEN", `Could not restore webhook fields: ${stillMissing.join(", ")}.`, now);
      } else {
        outcome.webhook = restored ? "restored" : "ok";
      }
    } catch (err) {
      const failure = classifyMetaError(err);
      outcome.webhook = "failed";
      if (failure.kind === "transient") {
        await db.instagramAccount.update({
          where: { id: account.id },
          data: { webhookCheckedAt: now, webhookError: failure.message },
        });
      } else {
        status = "NEEDS_RECONNECT";
        await markNeedsReconnect(db, account, "Instagram rejected the saved login. Reconnect this account.", failure.message);
        await raiseAlert(db, alertInfo, "NEEDS_RECONNECT", "Instagram rejected the saved login.", now);
      }
    }
  }

  outcome.status = status;
  if (wasStatus !== "ACTIVE" && status === "ACTIVE") {
    await noteRecovery(db, alertInfo, wasStatus);
    await db.instagramAccount.update({ where: { id: account.id }, data: { lastAlertKind: null, lastAlertAt: null } });
  }
}

async function markNeedsReconnect(
  db: Db,
  account: { id: string },
  reason: string,
  detail?: string
): Promise<void> {
  await db.instagramAccount.update({
    where: { id: account.id },
    data: {
      connectionStatus: "NEEDS_RECONNECT",
      needsReconnectReason: reason,
      lastRefreshError: detail ?? reason,
    },
  });
}
