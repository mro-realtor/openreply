/**
 * Opt-in scheduling for the comment polling safety net.
 *
 * Polling reads recent comments from Meta for every ACTIVE campaign and queues a
 * DM or public reply for matching comments that webhooks missed. It contacts Meta
 * and can lead to messages being sent, so it only runs when COMMENT_POLLING_ENABLED
 * is exactly the text "true". A missing, empty or misspelled value keeps it off.
 *
 * This switch is independent of IG_MAINTENANCE_ENABLED (token renewal). Neither
 * one turns the other on or off.
 */
export const DEFAULT_COMMENT_POLL_INTERVAL_MS = 5 * 60_000;
export const MIN_COMMENT_POLL_INTERVAL_MS = 60_000;
export const MAX_COMMENT_POLL_INTERVAL_MS = 2_147_483_647;
export const COMMENT_POLL_FIRST_RUN_DELAY_MS = 10_000;

type Env = Record<string, string | undefined>;

export function isCommentPollingEnabled(env: Env = process.env): boolean {
  return env.COMMENT_POLLING_ENABLED === "true";
}

/** A bad interval falls back to the default instead of becoming a tight loop. */
export function commentPollIntervalMs(env: Env = process.env): number {
  const raw = env.COMMENT_POLL_INTERVAL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_COMMENT_POLL_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_COMMENT_POLL_INTERVAL_MS || n > MAX_COMMENT_POLL_INTERVAL_MS) {
    return DEFAULT_COMMENT_POLL_INTERVAL_MS;
  }
  return Math.floor(n);
}

export interface PollingHandle {
  stop(): void;
}

/** Returns null, and sets no timers at all, unless polling is explicitly enabled. */
export function startCommentPolling(
  run: () => Promise<unknown> | unknown,
  options: { env?: Env; log?: (message: string) => void } = {}
): PollingHandle | null {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  if (!isCommentPollingEnabled(env)) {
    log('Comment polling is OFF. It contacts Meta and can queue messages, so it only runs when COMMENT_POLLING_ENABLED is exactly "true".');
    return null;
  }
  const interval = commentPollIntervalMs(env);
  const tick = () => {
    void Promise.resolve()
      .then(run)
      .catch(() => log("Comment polling run failed"));
  };
  const first = setTimeout(tick, COMMENT_POLL_FIRST_RUN_DELAY_MS);
  const timer = setInterval(tick, interval);
  log(`Comment polling is ON: first run in ${COMMENT_POLL_FIRST_RUN_DELAY_MS / 1000}s, then every ${Math.round(interval / 60_000)} minutes.`);
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
