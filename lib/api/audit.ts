import { redact } from "@/lib/api/redact";
import type { Channel, Db } from "@/lib/api/types";

export interface AuditEntry {
  workspaceId?: string | null;
  apiTokenId?: string | null;
  actorUserId?: string | null;
  channel: Channel;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: "SUCCESS" | "DENIED" | "ERROR";
  details?: unknown;
}

const MAX_DETAILS_CHARS = 4000;

export function prepareDetails(details: unknown): unknown {
  if (details === undefined) return undefined;
  const cleaned = redact(details);
  const text = JSON.stringify(cleaned);
  if (text && text.length > MAX_DETAILS_CHARS) {
    return { truncated: true, preview: text.slice(0, MAX_DETAILS_CHARS) };
  }
  return cleaned;
}

/**
 * Writes an audit row. Auditing must never take a request down, so failures
 * are swallowed; the caller's result is what matters to the client.
 */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  try {
    const details = prepareDetails(entry.details);
    await db.auditLog.create({
      data: {
        workspaceId: entry.workspaceId ?? null,
        apiTokenId: entry.apiTokenId ?? null,
        actorUserId: entry.actorUserId ?? null,
        channel: entry.channel,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        outcome: entry.outcome,
        ...(details !== undefined
          ? { details: details as object }
          : {}),
      },
    });
  } catch {
    // intentionally ignored
  }
}
