/**
 * Pure rules for Instagram connection upkeep. No database, no network, so every
 * rule here is unit tested directly.
 *
 * Meta rules this encodes (Instagram API with Instagram Login):
 *  - A long-lived token lasts 60 days.
 *  - It can be refreshed only while still valid and at least 24 hours old.
 *  - An expired or revoked token cannot be refreshed; the account owner must
 *    log in again.
 */

export const REFRESH_WINDOW_DAYS = 21;
export const MIN_TOKEN_AGE_MS = 25 * 3_600_000;
export const TOKEN_LIFETIME_MS = 60 * 86_400_000;
export const WEBHOOK_ACTIVE_WINDOW_DAYS = 7;
export const DEGRADED_AFTER_FAILURES = 3;
export const ALERT_REPEAT_HOURS = 24;
export const REQUIRED_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
] as const;
export const REQUIRED_WEBHOOK_FIELDS = ["comments", "messages"] as const;

export type ConnectionStatus = "ACTIVE" | "DEGRADED" | "NEEDS_RECONNECT";
export type ErrorKind = "transient" | "reauth" | "permission";
export type WebhookHealth = "healthy" | "inactive" | "degraded" | "disconnected";

/** Removes anything that looks like a credential before it is stored or logged. */
export function sanitizeError(message: string): string {
  return message
    .replace(/(access_token|client_secret|refresh_token)=[^&\s"']+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_\-]{40,}/g, "[redacted]")
    .slice(0, 300);
}

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

/** Decides whether a failed Meta call is worth retrying or needs the owner. */
export function classifyMetaError(err: unknown): { kind: ErrorKind; message: string } {
  const message = sanitizeError(err instanceof Error ? err.message : String(err));
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  const name = err instanceof Error ? err.name : "";

  if (name === "TokenExpiredError" || code === 190) return { kind: "reauth", message };
  if (name === "PermissionError" || code === 10 || code === 200 || code === 100) {
    return { kind: "permission", message };
  }
  if (name === "RateLimitError" || (typeof code === "number" && (TRANSIENT_CODES.has(code) || code >= 500))) {
    return { kind: "transient", message };
  }
  // Network failures, timeouts and unparseable gateway responses.
  return { kind: "transient", message };
}

/** When a token should next be refreshed: REFRESH_WINDOW_DAYS before it expires. */
export function plannedRefreshAt(expiresAt: Date): Date {
  return new Date(expiresAt.getTime() - REFRESH_WINDOW_DAYS * 86_400_000);
}

/** Retry delay after the Nth consecutive failure: 1h, 2h, 4h, 8h, then 24h. */
export function backoffMs(failures: number): number {
  const hours = [1, 2, 4, 8, 24][Math.min(Math.max(failures, 1), 5) - 1];
  return hours * 3_600_000;
}

export interface RefreshInput {
  now: Date;
  tokenExpiresAt: Date | null;
  nextRefreshAt: Date | null;
  lastRefreshAt: Date | null;
  connectedAt: Date;
  status: ConnectionStatus;
}

export type RefreshDecision =
  | { action: "refresh" }
  | { action: "skip"; reason: "not_due" | "needs_reconnect" | "token_too_new" | "no_expiry" }
  | { action: "expired" };

export function decideRefresh(input: RefreshInput): RefreshDecision {
  if (input.status === "NEEDS_RECONNECT") return { action: "skip", reason: "needs_reconnect" };
  if (!input.tokenExpiresAt) return { action: "skip", reason: "no_expiry" };
  if (input.tokenExpiresAt.getTime() <= input.now.getTime()) return { action: "expired" };

  const due = input.nextRefreshAt ?? plannedRefreshAt(input.tokenExpiresAt);
  if (due.getTime() > input.now.getTime()) return { action: "skip", reason: "not_due" };

  const issuedAt = input.lastRefreshAt ?? input.connectedAt;
  if (input.now.getTime() - issuedAt.getTime() < MIN_TOKEN_AGE_MS) {
    return { action: "skip", reason: "token_too_new" };
  }
  return { action: "refresh" };
}

export function missingScopes(granted: string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !granted.includes(s));
}

export function missingWebhookFields(subscribed: string[]): string[] {
  return REQUIRED_WEBHOOK_FIELDS.filter((f) => !subscribed.includes(f));
}

/**
 * Webhook state shown to the owner. Silence alone is never a failure: a
 * correctly subscribed account with no recent events is "inactive", not broken.
 */
export function deriveWebhookHealth(input: {
  now: Date;
  status: ConnectionStatus;
  webhookSubscribed: boolean;
  lastWebhookAt: Date | null;
}): WebhookHealth {
  if (input.status === "NEEDS_RECONNECT") return "disconnected";
  if (!input.webhookSubscribed) return "degraded";
  const windowMs = WEBHOOK_ACTIVE_WINDOW_DAYS * 86_400_000;
  if (input.lastWebhookAt && input.now.getTime() - input.lastWebhookAt.getTime() <= windowMs) {
    return "healthy";
  }
  return "inactive";
}

/** Entry ids from a Meta webhook payload, used to stamp "last event received". */
export function extractEntryIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const ids = new Set<string>();
  for (const e of entries) {
    const id = (e as { id?: unknown } | null)?.id;
    if (typeof id === "string" || typeof id === "number") ids.add(String(id));
  }
  return [...ids];
}
