/**
 * Opt-in scheduling for the Instagram connection upkeep.
 *
 * The upkeep renews tokens and re-subscribes webhooks, which means it contacts Meta.
 * It therefore never runs unless IG_MAINTENANCE_ENABLED is exactly the text "true".
 * A missing, empty or misspelled value (false, FALSE, True, 1, yes, " true") keeps it off.
 */
export const DEFAULT_MAINTENANCE_INTERVAL_MS = 6 * 3_600_000;
export const MIN_MAINTENANCE_INTERVAL_MS = 15 * 60_000;
export const MAX_MAINTENANCE_INTERVAL_MS = 2_147_483_647;
export const FIRST_RUN_DELAY_MS = 60_000;

type Env = Record<string, string | undefined>;

export function isIgMaintenanceEnabled(env: Env = process.env): boolean {
  return env.IG_MAINTENANCE_ENABLED === "true";
}

/** A bad interval falls back to the default instead of becoming a tight loop. */
export function maintenanceIntervalMs(env: Env = process.env): number {
  const raw = env.IG_MAINTENANCE_INTERVAL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAINTENANCE_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_MAINTENANCE_INTERVAL_MS || n > MAX_MAINTENANCE_INTERVAL_MS) {
    return DEFAULT_MAINTENANCE_INTERVAL_MS;
  }
  return Math.floor(n);
}

export interface MaintenanceHandle {
  stop(): void;
}

/** Returns null, and sets no timers at all, unless the upkeep is explicitly enabled. */
export function startInstagramMaintenance(
  run: () => Promise<unknown> | unknown,
  options: { env?: Env; log?: (message: string) => void } = {}
): MaintenanceHandle | null {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  if (!isIgMaintenanceEnabled(env)) {
    log('Instagram maintenance is OFF. It contacts Meta, so it only runs when IG_MAINTENANCE_ENABLED is exactly "true".');
    return null;
  }
  const interval = maintenanceIntervalMs(env);
  const tick = () => {
    void Promise.resolve()
      .then(run)
      .catch(() => log("Instagram maintenance run failed"));
  };
  const first = setTimeout(tick, FIRST_RUN_DELAY_MS);
  const timer = setInterval(tick, interval);
  log(`Instagram maintenance is ON: first run in ${FIRST_RUN_DELAY_MS / 1000}s, then every ${Math.round(interval / 60_000)} minutes.`);
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
