import { describe, expect, it } from "vitest";
import {
  clampLifetimeDays,
  generateApiToken,
  getTokenState,
  hashApiToken,
  isWellFormedToken,
  parseBearerToken,
} from "@/lib/api/tokens";
import {
  ISSUABLE_SCOPES,
  hasScope,
  isIssuableScope,
} from "@/lib/api/scopes";
import { redact, redactString } from "@/lib/api/redact";
import {
  buildPage,
  cursorWhere,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from "@/lib/api/pagination";
import { enforceRateLimit, type RateLimitStore } from "@/lib/api/rate-limit";
import { prepareDetails } from "@/lib/api/audit";
import { ApiError } from "@/lib/api/errors";

describe("api tokens", () => {
  it("generates a well formed 256 bit secret and only exposes a short prefix", () => {
    const t = generateApiToken();
    expect(isWellFormedToken(t.secret)).toBe(true);
    expect(t.secret.startsWith("orp_")).toBe(true);
    expect(t.displayPrefix.length).toBe(12);
    expect(t.secret.startsWith(t.displayPrefix)).toBe(true);
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(t.hash).not.toContain(t.secret);
  });

  it("hashes deterministically and never repeats a secret", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.secret).not.toBe(b.secret);
    expect(hashApiToken(a.secret)).toBe(a.hash);
    expect(hashApiToken(a.secret)).not.toBe(b.hash);
  });

  it("rejects malformed tokens", () => {
    expect(isWellFormedToken("orp_short")).toBe(false);
    expect(isWellFormedToken("sk-" + "a".repeat(43))).toBe(false);
    expect(isWellFormedToken("")).toBe(false);
  });

  it("parses bearer headers strictly", () => {
    expect(parseBearerToken("Bearer abc")).toBe("abc");
    expect(parseBearerToken("bearer abc")).toBe("abc");
    expect(parseBearerToken("Basic abc")).toBeNull();
    expect(parseBearerToken("Bearer a b")).toBeNull();
    expect(parseBearerToken(null)).toBeNull();
  });

  it("reports token state", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const future = new Date("2026-11-01T00:00:00Z");
    const past = new Date("2026-10-01T00:00:00Z");
    expect(getTokenState({ revokedAt: null, expiresAt: future }, now)).toBe("active");
    expect(getTokenState({ revokedAt: null, expiresAt: past }, now)).toBe("expired");
    expect(getTokenState({ revokedAt: past, expiresAt: future }, now)).toBe("revoked");
  });

  it("caps token lifetime at 90 days", () => {
    expect(clampLifetimeDays(undefined)).toBe(30);
    expect(clampLifetimeDays(9999)).toBe(90);
    expect(clampLifetimeDays(0)).toBe(1);
  });
});

describe("scopes", () => {
  it("only issues scopes whose features exist", () => {
    expect([...ISSUABLE_SCOPES].sort()).toEqual(["drafts:write", "read"]);
    for (const reserved of ["send", "activate", "leads:read", "campaigns:modify"]) {
      expect(isIssuableScope(reserved)).toBe(false);
    }
  });

  it("checks granted scopes exactly", () => {
    expect(hasScope(["read"], "read")).toBe(true);
    expect(hasScope(["read"], "drafts:write")).toBe(false);
  });
});

describe("redaction", () => {
  it("redacts sensitive keys at any depth", () => {
    const out = redact({
      name: "ok",
      accessToken: "abc",
      nested: { Authorization: "Bearer xyz", apiKey: "k", fine: 1 },
      list: [{ password: "p" }],
    });
    expect(out.accessToken).toBe("[redacted]");
    expect(out.nested.Authorization).toBe("[redacted]");
    expect(out.nested.apiKey).toBe("[redacted]");
    expect(out.nested.fine).toBe(1);
    expect(out.list[0].password).toBe("[redacted]");
    expect(out.name).toBe("ok");
  });

  it("scrubs secret shaped substrings in free text", () => {
    const secret = generateApiToken().secret;
    const text = `failed with ${secret} and Bearer abcdefghijklmnop1234`;
    const cleaned = redactString(text);
    expect(cleaned).not.toContain(secret);
    expect(cleaned).not.toContain("abcdefghijklmnop1234");
  });

  it("redacts audit details and truncates oversized ones", () => {
    expect(prepareDetails({ token: "t" })).toEqual({ token: "[redacted]" });
    const big = prepareDetails({ blob: "x".repeat(10_000) }) as { truncated: boolean };
    expect(big.truncated).toBe(true);
  });
});

describe("pagination", () => {
  const rows = [3, 2, 1].map((n) => ({
    id: `id${n}`,
    createdAt: new Date(`2026-10-0${n}T00:00:00Z`),
  }));

  it("round trips cursors and rejects tampering", () => {
    const cursor = encodeCursor(rows[0]);
    const decoded = decodeCursor(cursor);
    expect(decoded?.id).toBe("id3");
    expect(decoded?.createdAt.toISOString()).toBe(rows[0].createdAt.toISOString());
    expect(() => decodeCursor("not-a-cursor")).toThrow(ApiError);
    expect(() =>
      decodeCursor(Buffer.from('{"c":"nope","i":"x"}').toString("base64url"))
    ).toThrow(ApiError);
    expect(decodeCursor(null)).toBeNull();
  });

  it("builds pages with a next cursor only when more rows exist", () => {
    const first = buildPage(rows, 2, (r) => r.createdAt);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const last = buildPage(rows.slice(0, 2), 2, (r) => r.createdAt);
    expect(last.nextCursor).toBeNull();
  });

  it("validates and caps limits", () => {
    expect(parseLimit(undefined)).toBe(25);
    expect(parseLimit("500")).toBe(100);
    expect(() => parseLimit("0")).toThrow(ApiError);
    expect(() => parseLimit("abc")).toThrow(ApiError);
  });

  it("builds a keyset where clause on the chosen field", () => {
    const where = cursorWhere(decodeCursor(encodeCursor(rows[0])), "connectedAt");
    expect(JSON.stringify(where)).toContain("connectedAt");
    expect(cursorWhere(null)).toEqual({});
  });
});

describe("rate limiting", () => {
  function memoryStore(): RateLimitStore {
    const counts = new Map<string, number>();
    return {
      async increment(key) {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return n;
      },
    };
  }

  it("allows up to the limit then returns 429 with Retry-After", async () => {
    const store = memoryStore();
    const now = Date.UTC(2026, 9, 14, 12, 0, 10);
    await enforceRateLimit(store, "tok", { limit: 2, now });
    await enforceRateLimit(store, "tok", { limit: 2, now });
    const err = await enforceRateLimit(store, "tok", { limit: 2, now }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(Number(err.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("tracks tokens separately and resets next window", async () => {
    const store = memoryStore();
    const now = Date.UTC(2026, 9, 14, 12, 0, 10);
    await enforceRateLimit(store, "a", { limit: 1, now });
    await enforceRateLimit(store, "b", { limit: 1, now });
    await enforceRateLimit(store, "a", { limit: 1, now: now + 61_000 });
  });

  it("fails closed when the store is down", async () => {
    const broken: RateLimitStore = {
      async increment() {
        throw new Error("redis down");
      },
    };
    const err = await enforceRateLimit(broken, "t", { limit: 5 }).catch((e) => e);
    expect(err.status).toBe(503);
  });
});
