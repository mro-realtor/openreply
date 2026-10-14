import { describe, expect, it } from "vitest";
import { AUTO_DISABLE_AFTER, MAX_ATTEMPTS, allowedPrivateHosts, backoffMs, isKnownEventType, isOutboundWebhooksEnabled } from "@/lib/outbound/config";
import { decideOutcome } from "@/lib/outbound/deliver";
import { generateSecret, signPayload, verifySignature } from "@/lib/outbound/signing";
import { assertPublicHost, isPrivateIp, validateWebhookUrl } from "@/lib/outbound/url-guard";

describe("outbound config", () => {
  it("is off unless explicitly enabled", () => {
    expect(isOutboundWebhooksEnabled({})).toBe(false);
    expect(isOutboundWebhooksEnabled({ OUTBOUND_WEBHOOKS_ENABLED: "false" })).toBe(false);
    expect(isOutboundWebhooksEnabled({ OUTBOUND_WEBHOOKS_ENABLED: "true" })).toBe(true);
  });
  it("parses the allowed host list", () => {
    expect(allowedPrivateHosts({ OUTBOUND_WEBHOOK_ALLOWED_HOSTS: " N8N.internal ,, crm " })).toEqual(["n8n.internal", "crm"]);
    expect(allowedPrivateHosts({})).toEqual([]);
  });
  it("knows the event names", () => {
    expect(isKnownEventType("dm.sent")).toBe(true);
    expect(isKnownEventType("dm.exploded")).toBe(false);
  });
  it("backs off 1m, 5m, 30m, 2h, 6h, 12h, 24h and stays at 24h", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(backoffMs)).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000, 86_400_000, 86_400_000,
    ]);
  });
});

describe("signing", () => {
  const secret = generateSecret();
  const body = JSON.stringify({ hello: "world" });
  const now = 1_800_000_000_000;
  const header = signPayload(secret, now / 1000, body);

  it("makes unique secrets with a recognisable prefix", () => {
    expect(secret.startsWith("whsec_")).toBe(true);
    expect(generateSecret()).not.toBe(secret);
  });
  it("verifies an untouched request", () => {
    expect(verifySignature({ secret, header, body, nowMs: now })).toBe(true);
  });
  it("rejects a changed body, wrong secret, missing or malformed header", () => {
    expect(verifySignature({ secret, header, body: body + " ", nowMs: now })).toBe(false);
    expect(verifySignature({ secret: "whsec_other", header, body, nowMs: now })).toBe(false);
    expect(verifySignature({ secret, header: null, body, nowMs: now })).toBe(false);
    expect(verifySignature({ secret, header: "garbage", body, nowMs: now })).toBe(false);
    expect(verifySignature({ secret, header: "t=abc,v1=00", body, nowMs: now })).toBe(false);
  });
  it("rejects a replay outside the time window", () => {
    expect(verifySignature({ secret, header, body, nowMs: now + 299_000 })).toBe(true);
    expect(verifySignature({ secret, header, body, nowMs: now + 301_000 })).toBe(false);
    expect(verifySignature({ secret, header, body, nowMs: now - 301_000 })).toBe(false);
  });
  it("accepts any matching v1 value (secret rotation)", () => {
    const [t, v1] = header.split(",");
    expect(verifySignature({ secret, header: `${t},v1=deadbeef,${v1}`, body, nowMs: now })).toBe(true);
  });
});

describe("url guard", () => {
  it("accepts a normal https URL", () => {
    expect(validateWebhookUrl("https://hooks.example.com/abc").ok).toBe(true);
  });
  it.each([
    ["http://hooks.example.com/x", "plain http"],
    ["https://localhost/x", "localhost"],
    ["https://app.localhost/x", "localhost subdomain"],
    ["https://db.internal/x", ".internal"],
    ["https://127.0.0.1/x", "loopback"],
    ["https://10.1.2.3/x", "10/8"],
    ["https://172.20.0.5/x", "172.16/12"],
    ["https://192.168.1.9/x", "192.168/16"],
    ["https://169.254.169.254/latest/meta-data", "cloud metadata"],
    ["https://100.64.0.1/x", "carrier NAT"],
    ["https://0.0.0.0/x", "unspecified"],
    ["https://[::1]/x", "ipv6 loopback"],
    ["https://[fd00::1]/x", "ipv6 unique local"],
    ["https://[fe80::1]/x", "ipv6 link-local"],
    ["https://[::ffff:127.0.0.1]/x", "ipv4 mapped loopback"],
    ["https://user:pass@hooks.example.com/x", "credentials in url"],
    ["ftp://hooks.example.com/x", "other scheme"],
    ["not a url", "garbage"],
  ])("rejects %s (%s)", (url) => {
    expect(validateWebhookUrl(url).ok).toBe(false);
  });
  it("lets an explicitly allowed host use http and private addresses", () => {
    expect(validateWebhookUrl("http://n8n.lan:5678/webhook/x", { allowedHosts: ["n8n.lan"] }).ok).toBe(true);
    expect(validateWebhookUrl("http://10.0.0.4:5678/x", { allowedHosts: ["10.0.0.4"] }).ok).toBe(true);
    expect(validateWebhookUrl("http://other.lan/x", { allowedHosts: ["n8n.lan"] }).ok).toBe(false);
  });
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.0.1", "169.254.1.1", "::1", "fc00::1", "not-an-ip"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
  it("refuses a public name that resolves to a private address", async () => {
    const url = new URL("https://sneaky.example.com/x");
    await expect(assertPublicHost(url, { lookup: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.9" }] })).rejects.toThrow(/private/);
    await expect(assertPublicHost(url, { lookup: async () => [{ address: "93.184.216.34" }] })).resolves.toBeUndefined();
    await expect(assertPublicHost(url, { lookup: async () => [] })).rejects.toThrow(/resolve/);
    await expect(assertPublicHost(url, { allowedHosts: ["sneaky.example.com"], lookup: async () => [{ address: "10.0.0.9" }] })).resolves.toBeUndefined();
  });
});

describe("retry rules", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  it("delivers on any 2xx", () => {
    for (const statusCode of [200, 201, 204]) expect(decideOutcome({ statusCode, attemptsMade: 1, now })).toEqual({ kind: "delivered" });
  });
  it("treats 410 as gone", () => {
    expect(decideOutcome({ statusCode: 410, attemptsMade: 1, now })).toEqual({ kind: "gone" });
  });
  it("retries everything else with backoff, redirects and network errors included", () => {
    for (const statusCode of [301, 400, 404, 429, 500, 503, null]) {
      expect(decideOutcome({ statusCode, attemptsMade: 1, now })).toEqual({ kind: "retry", nextAttemptAt: new Date(now.getTime() + 60_000) });
    }
    expect(decideOutcome({ statusCode: 500, attemptsMade: 3, now })).toEqual({ kind: "retry", nextAttemptAt: new Date(now.getTime() + 1_800_000) });
  });
  it("gives up after the last allowed attempt", () => {
    expect(decideOutcome({ statusCode: 500, attemptsMade: MAX_ATTEMPTS - 1, now }).kind).toBe("retry");
    expect(decideOutcome({ statusCode: 500, attemptsMade: MAX_ATTEMPTS, now })).toEqual({ kind: "dead" });
    expect(AUTO_DISABLE_AFTER).toBeGreaterThan(MAX_ATTEMPTS);
  });
});
