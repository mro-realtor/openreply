import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classifyMetaError,
  decideRefresh,
  deriveWebhookHealth,
  extractEntryIds,
  missingScopes,
  plannedRefreshAt,
  sanitizeError,
} from "@/lib/instagram/health";
import { parsePermissions } from "@/lib/meta/oauth";
import { toConnectionView, type ConnectionRow } from "@/lib/instagram/view";
import { MetaApiError, PermissionError, RateLimitError, TokenExpiredError } from "@/lib/meta/client";

const DAY = 86_400_000;
const now = new Date("2026-10-20T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * DAY);

describe("refresh decisions", () => {
  const base = { now, lastRefreshAt: null, connectedAt: days(-40), status: "ACTIVE" as const };

  it("refreshes only inside the 21 day window", () => {
    expect(decideRefresh({ ...base, tokenExpiresAt: days(30), nextRefreshAt: null })).toEqual({ action: "skip", reason: "not_due" });
    expect(decideRefresh({ ...base, tokenExpiresAt: days(21), nextRefreshAt: null })).toEqual({ action: "refresh" });
    expect(decideRefresh({ ...base, tokenExpiresAt: days(5), nextRefreshAt: null })).toEqual({ action: "refresh" });
  });
  it("respects a backoff time set after a failure", () => {
    expect(decideRefresh({ ...base, tokenExpiresAt: days(5), nextRefreshAt: days(0.1) })).toEqual({ action: "skip", reason: "not_due" });
  });
  it("never refreshes a token younger than 24 hours", () => {
    const fresh = { ...base, connectedAt: new Date(now.getTime() - 3_600_000), tokenExpiresAt: days(10), nextRefreshAt: null };
    expect(decideRefresh(fresh)).toEqual({ action: "skip", reason: "token_too_new" });
  });
  it("reports an expired token instead of trying to refresh it", () => {
    expect(decideRefresh({ ...base, tokenExpiresAt: days(-1), nextRefreshAt: null })).toEqual({ action: "expired" });
  });
  it("leaves accounts that need a reconnect alone", () => {
    expect(decideRefresh({ ...base, status: "NEEDS_RECONNECT", tokenExpiresAt: days(5), nextRefreshAt: null })).toEqual({ action: "skip", reason: "needs_reconnect" });
  });
  it("plans the next refresh 21 days before expiry", () => {
    expect(plannedRefreshAt(days(60)).getTime()).toBe(days(39).getTime());
  });
  it("backs off 1h, 2h, 4h, 8h then 24h", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffMs(n) / 3_600_000)).toEqual([1, 2, 4, 8, 24, 24]);
  });
});

describe("error classification", () => {
  it("treats a rejected login as needing the owner", () => {
    expect(classifyMetaError(new TokenExpiredError("Error validating access token")).kind).toBe("reauth");
  });
  it("treats removed permissions as needing the owner", () => {
    expect(classifyMetaError(new PermissionError("permission denied")).kind).toBe("permission");
  });
  it("retries rate limits, server errors and network failures", () => {
    expect(classifyMetaError(new RateLimitError("slow down")).kind).toBe("transient");
    expect(classifyMetaError(new MetaApiError(503, undefined, undefined, "unavailable")).kind).toBe("transient");
    expect(classifyMetaError(new TypeError("fetch failed")).kind).toBe("transient");
  });
  it("redacts credentials from stored messages", () => {
    const long = "IGAA" + "x".repeat(120);
    const out = sanitizeError(`failed: access_token=${long} and Bearer ${long} and ${long}`);
    expect(out).not.toContain(long);
    expect(out).toContain("[redacted]");
  });
});

describe("webhook health", () => {
  const sub = { now, status: "ACTIVE" as const, webhookSubscribed: true };
  it("is healthy with a recent event", () => {
    expect(deriveWebhookHealth({ ...sub, lastWebhookAt: days(-2) })).toBe("healthy");
  });
  it("is inactive, not failed, when subscribed but quiet", () => {
    expect(deriveWebhookHealth({ ...sub, lastWebhookAt: days(-30) })).toBe("inactive");
    expect(deriveWebhookHealth({ ...sub, lastWebhookAt: null })).toBe("inactive");
  });
  it("is degraded when the subscription is missing", () => {
    expect(deriveWebhookHealth({ ...sub, webhookSubscribed: false, lastWebhookAt: days(-1) })).toBe("degraded");
  });
  it("is disconnected when the account needs a reconnect", () => {
    expect(deriveWebhookHealth({ ...sub, status: "NEEDS_RECONNECT", lastWebhookAt: days(-1) })).toBe("disconnected");
  });
});

describe("helpers", () => {
  it("reads webhook entry ids", () => {
    expect(extractEntryIds({ entry: [{ id: "1" }, { id: 2 }, { id: "1" }, {}] })).toEqual(["1", "2"]);
    expect(extractEntryIds(null)).toEqual([]);
    expect(extractEntryIds({ entry: "x" })).toEqual([]);
  });
  it("parses granted permissions in either format", () => {
    expect(parsePermissions("a, b")).toEqual(["a", "b"]);
    expect(parsePermissions(["a", "b"])).toEqual(["a", "b"]);
    expect(parsePermissions(undefined)).toEqual([]);
  });
  it("finds missing scopes", () => {
    expect(missingScopes(["instagram_business_basic"])).toEqual([
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
    ]);
  });
});

describe("connection view", () => {
  const row: ConnectionRow = {
    id: "a1", username: "nancyobeauty", name: null, connectedAt: days(-50), tokenExpiresAt: days(40),
    webhookSubscribed: true, connectionStatus: "ACTIVE", needsReconnectReason: null, connectedByUserId: "u1",
    grantedScopes: [], lastRefreshAt: days(-10), nextRefreshAt: null, lastRefreshError: null,
    webhookCheckedAt: days(-1), webhookError: null, lastWebhookAt: days(-1),
  };
  it("shows a healthy account with no issues and no reconnect button", () => {
    const v = toConnectionView(row, "Nancy", now);
    expect(v).toMatchObject({ status: "ACTIVE", connectedBy: "Nancy", issues: [], canReconnect: false, daysUntilExpiry: 40 });
    expect(v.webhook.health).toBe("healthy");
    expect(v.nextRefreshAt).toBe(days(19).toISOString());
  });
  it("shows the reason and a reconnect option when login is rejected", () => {
    const v = toConnectionView({ ...row, connectionStatus: "NEEDS_RECONNECT", needsReconnectReason: "Instagram rejected the saved login. Reconnect this account." }, null, now);
    expect(v.canReconnect).toBe(true);
    expect(v.nextRefreshAt).toBeNull();
    expect(v.webhook.health).toBe("disconnected");
    expect(v.issues[0]).toContain("rejected");
  });
  it("never exposes a token field", () => {
    expect(JSON.stringify(toConnectionView(row, null, now))).not.toMatch(/accessToken/i);
  });
});
