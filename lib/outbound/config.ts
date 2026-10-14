/**
 * Outbound webhooks are OFF by default. When off, nothing is queued and no
 * request is ever sent to a third party.
 */
export function isOutboundWebhooksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.OUTBOUND_WEBHOOKS_ENABLED === "true";
}

/**
 * Hostnames that may resolve to private addresses or use plain http, for
 * example an n8n container on the same private network. Comma separated,
 * exact hostnames only (no wildcards).
 */
export function allowedPrivateHosts(env: Record<string, string | undefined> = process.env): string[] {
  return (env.OUTBOUND_WEBHOOK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export const EVENT_TYPES = [
  "ping",
  "dm.sent",
  "dm.skipped",
  "dm.failed",
  "contact.opted_out",
  "contact.human_takeover",
] as const;
export type OutboundEventType = (typeof EVENT_TYPES)[number];

export function isKnownEventType(value: string): value is OutboundEventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** A delivery is tried this many times in total, then marked DEAD (replayable by hand). */
export const MAX_ATTEMPTS = 8;
/** An endpoint that fails this many deliveries in a row is switched off and an alert is recorded. */
export const AUTO_DISABLE_AFTER = 20;
export const REQUEST_TIMEOUT_MS = 10_000;
export const LOCK_MS = 60_000;

const BACKOFF_MS = [
  60_000, // 1 minute
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
];

/** Wait before the next try, given how many tries have now been made (1 = first failure). */
export function backoffMs(attemptsMade: number): number {
  const i = Math.min(Math.max(attemptsMade, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i];
}
