import {
  deriveWebhookHealth,
  missingScopes,
  plannedRefreshAt,
  type ConnectionStatus,
  type WebhookHealth,
} from "@/lib/instagram/health";

/** Columns the dashboard needs. Deliberately excludes accessToken. */
export const CONNECTION_SELECT = {
  id: true,
  username: true,
  name: true,
  connectedAt: true,
  tokenExpiresAt: true,
  webhookSubscribed: true,
  connectionStatus: true,
  needsReconnectReason: true,
  connectedByUserId: true,
  grantedScopes: true,
  lastRefreshAt: true,
  nextRefreshAt: true,
  lastRefreshError: true,
  webhookCheckedAt: true,
  webhookError: true,
  lastWebhookAt: true,
} as const;

export interface ConnectionRow {
  id: string;
  username: string;
  name: string | null;
  connectedAt: Date;
  tokenExpiresAt: Date | null;
  webhookSubscribed: boolean;
  connectionStatus: ConnectionStatus;
  needsReconnectReason: string | null;
  connectedByUserId: string | null;
  grantedScopes: string[];
  lastRefreshAt: Date | null;
  nextRefreshAt: Date | null;
  lastRefreshError: string | null;
  webhookCheckedAt: Date | null;
  webhookError: string | null;
  lastWebhookAt: Date | null;
}

export interface ConnectionView {
  id: string;
  username: string;
  status: ConnectionStatus;
  tokenExpiresAt: string | null;
  daysUntilExpiry: number | null;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  webhook: {
    subscribed: boolean;
    health: WebhookHealth;
    lastEventAt: string | null;
    lastCheckedAt: string | null;
  };
  connectedBy: string | null;
  issues: string[];
  canReconnect: boolean;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toConnectionView(
  row: ConnectionRow,
  connectedBy: string | null,
  now: Date = new Date()
): ConnectionView {
  const issues: string[] = [];
  if (row.connectionStatus === "NEEDS_RECONNECT") {
    issues.push(row.needsReconnectReason ?? "This account needs to be reconnected.");
  }
  const absent = row.grantedScopes.length > 0 ? missingScopes(row.grantedScopes) : [];
  if (absent.length > 0) issues.push(`Missing permissions: ${absent.join(", ")}. Reconnect to grant them.`);
  if (row.connectionStatus === "DEGRADED" && row.lastRefreshError && absent.length === 0) {
    issues.push(`Automatic renewal is failing: ${row.lastRefreshError}`);
  }
  if (row.webhookError && row.connectionStatus !== "NEEDS_RECONNECT") {
    issues.push(`Webhook problem: ${row.webhookError}`);
  }

  const daysUntilExpiry = row.tokenExpiresAt
    ? Math.floor((row.tokenExpiresAt.getTime() - now.getTime()) / 86_400_000)
    : null;
  const nextRefresh =
    row.connectionStatus === "NEEDS_RECONNECT"
      ? null
      : row.nextRefreshAt ?? (row.tokenExpiresAt ? plannedRefreshAt(row.tokenExpiresAt) : null);

  return {
    id: row.id,
    username: row.username,
    status: row.connectionStatus,
    tokenExpiresAt: iso(row.tokenExpiresAt),
    daysUntilExpiry,
    lastRefreshAt: iso(row.lastRefreshAt),
    nextRefreshAt: iso(nextRefresh),
    webhook: {
      subscribed: row.webhookSubscribed,
      health: deriveWebhookHealth({
        now,
        status: row.connectionStatus,
        webhookSubscribed: row.webhookSubscribed,
        lastWebhookAt: row.lastWebhookAt,
      }),
      lastEventAt: iso(row.lastWebhookAt),
      lastCheckedAt: iso(row.webhookCheckedAt),
    },
    connectedBy,
    issues,
    canReconnect: row.connectionStatus !== "ACTIVE" || issues.length > 0,
  };
}
