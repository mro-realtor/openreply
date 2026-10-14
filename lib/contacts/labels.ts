/**
 * Plain words for contact states. Instagram DM permission is its own channel:
 * these labels never describe SMS or phone-call consent.
 */
export const FOLLOW_UP_LABEL: Record<string, string> = {
  UNASSIGNED: "Needs an owner",
  ASSIGNED: "Assigned",
  HUMAN_TAKEOVER: "A person is handling",
  OPTED_OUT: "Opted out",
};

export const DM_PERMISSION_LABEL: Record<string, string> = {
  UNKNOWN: "Not recorded",
  GRANTED: "Allowed",
  WITHDRAWN: "Withdrawn",
};

export const FOLLOW_UP_TONE: Record<string, string> = {
  UNASSIGNED: "text-warning",
  ASSIGNED: "text-foreground",
  HUMAN_TAKEOVER: "text-foreground",
  OPTED_OUT: "text-error",
};

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
