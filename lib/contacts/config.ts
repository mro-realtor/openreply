/**
 * Per-person dedup is OFF by default. When off, the DM worker behaves exactly
 * as before and writes nothing to the Contact tables.
 */
export function isContactsDedupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTACTS_DEDUP_ENABLED === "true";
}

/** Hours to wait before ANY campaign DMs the same person again. 0 disables the cross-campaign cooldown. */
export function getCooldownHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CONTACT_DM_COOLDOWN_HOURS ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}
