"use client";

import { useEffect, useState } from "react";

type Status = "ACTIVE" | "DEGRADED" | "NEEDS_RECONNECT";
type WebhookHealth = "healthy" | "inactive" | "degraded" | "disconnected";

interface Row {
  id: string;
  username: string;
  status: Status;
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

const STATUS_LABEL: Record<Status, { text: string; cls: string }> = {
  ACTIVE: { text: "Connected", cls: "border-success/20 bg-success/10 text-success" },
  DEGRADED: { text: "Needs attention", cls: "border-warning/20 bg-warning/10 text-warning" },
  NEEDS_RECONNECT: { text: "Reconnect needed", cls: "border-error/20 bg-error/10 text-error" },
};

const WEBHOOK_LABEL: Record<WebhookHealth, string> = {
  healthy: "Healthy, events arriving",
  inactive: "Subscribed, no recent events",
  degraded: "Subscription problem",
  disconnected: "Disconnected",
};

function date(value: string | null, fallback = "Not yet") {
  return value ? new Date(value).toLocaleDateString() : fallback;
}

function dateTime(value: string | null, fallback = "None yet") {
  return value ? new Date(value).toLocaleString() : fallback;
}

export function InstagramConnectionsCard() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/instagram/connection-health", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.success) setRows(payload.data.accounts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-foreground">Instagram connection health</h2>
      <p className="text-sm text-muted mt-1">
        OpenReply renews each account&apos;s login automatically before it expires. Each account is
        renewed with its own login, so accounts owned by different people stay separate.
      </p>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const label = STATUS_LABEL[row.status];
          return (
            <li key={row.id} className="rounded border border-border bg-surface/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">@{row.username}</p>
                <span className={`rounded border px-2 py-0.5 text-xs font-medium ${label.cls}`}>
                  {label.text}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
                <div>
                  <dt className="inline">Login expires: </dt>
                  <dd className="inline text-foreground">
                    {date(row.tokenExpiresAt, "Unknown")}
                    {row.daysUntilExpiry !== null && row.daysUntilExpiry >= 0
                      ? ` (${row.daysUntilExpiry} days)`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Last renewal: </dt>
                  <dd className="inline text-foreground">{date(row.lastRefreshAt)}</dd>
                </div>
                <div>
                  <dt className="inline">Next renewal: </dt>
                  <dd className="inline text-foreground">
                    {row.status === "NEEDS_RECONNECT" ? "Paused until reconnected" : date(row.nextRefreshAt, "Scheduled")}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Webhook: </dt>
                  <dd className="inline text-foreground">{WEBHOOK_LABEL[row.webhook.health]}</dd>
                </div>
                <div>
                  <dt className="inline">Last webhook event: </dt>
                  <dd className="inline text-foreground">{dateTime(row.webhook.lastEventAt)}</dd>
                </div>
                {row.connectedBy && (
                  <div>
                    <dt className="inline">Connected by: </dt>
                    <dd className="inline text-foreground">{row.connectedBy}</dd>
                  </div>
                )}
              </dl>
              {row.issues.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-error" role="alert">
                  {row.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              {row.canReconnect && (
                <div className="mt-3">
                  <a
                    href={`/api/instagram/connect?account=${encodeURIComponent(row.id)}`}
                    className="inline-flex items-center justify-center rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/5"
                  >
                    Reconnect @{row.username}
                  </a>
                  <p className="mt-1 text-xs text-muted">
                    Log in to this Instagram account when prompted. If someone else owns it, ask them
                    to open OpenReply and use this button; your other accounts are not affected.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
