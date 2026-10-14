import { describe, expect, it, vi } from "vitest";
import { authenticateBearer, requireScope } from "@/lib/api/auth";
import { generateApiToken } from "@/lib/api/tokens";
import type { RateLimitStore } from "@/lib/api/rate-limit";
import type { Db } from "@/lib/api/types";

const okStore: RateLimitStore = { increment: async () => 1 };

function dbWith(record: Record<string, unknown> | null) {
  const update = vi.fn().mockResolvedValue({});
  const db = {
    apiToken: {
      findUnique: vi.fn().mockResolvedValue(record),
      update,
    },
  } as unknown as Db;
  return { db, update };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "tok1",
    name: "Claude",
    workspaceId: "ws1",
    scopes: ["read"],
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    lastUsedAt: null,
    createdByUserId: "u1",
    ...overrides,
  };
}

describe("authenticateBearer", () => {
  it("rejects missing, malformed and unknown tokens with the same 401", async () => {
    const { db } = dbWith(null);
    const bad = [null, "Bearer nope", `Bearer ${generateApiToken().secret}`];
    for (const header of bad) {
      const err = await authenticateBearer(db, header, { rateLimitStore: okStore }).catch((e) => e);
      expect(err.status).toBe(401);
      expect(err.message).toBe("A valid API token is required");
    }
  });

  it("looks tokens up by hash, never by the raw secret", async () => {
    const t = generateApiToken();
    const { db } = dbWith(record());
    await authenticateBearer(db, `Bearer ${t.secret}`, { rateLimitStore: okStore });
    const call = (db.apiToken.findUnique as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toEqual({ tokenHash: t.hash });
    expect(JSON.stringify(call)).not.toContain(t.secret);
  });

  it("rejects expired and revoked tokens", async () => {
    const t = generateApiToken();
    for (const overrides of [
      { expiresAt: new Date(Date.now() - 1000) },
      { revokedAt: new Date() },
    ]) {
      const { db } = dbWith(record(overrides));
      const err = await authenticateBearer(db, `Bearer ${t.secret}`, { rateLimitStore: okStore }).catch((e) => e);
      expect(err.status).toBe(401);
    }
  });

  it("returns a workspace scoped context for a valid token", async () => {
    const t = generateApiToken();
    const { db, update } = dbWith(record({ scopes: ["read", "drafts:write"] }));
    const ctx = await authenticateBearer(db, `Bearer ${t.secret}`, { rateLimitStore: okStore });
    expect(ctx).toMatchObject({ workspaceId: "ws1", tokenId: "tok1", scopes: ["read", "drafts:write"] });
    expect(update).toHaveBeenCalledTimes(1); // first use records lastUsedAt
  });

  it("does not rewrite lastUsedAt on every call", async () => {
    const t = generateApiToken();
    const { db, update } = dbWith(record({ lastUsedAt: new Date() }));
    await authenticateBearer(db, `Bearer ${t.secret}`, { rateLimitStore: okStore });
    expect(update).not.toHaveBeenCalled();
  });

  it("applies the rate limit after authentication", async () => {
    const t = generateApiToken();
    const { db } = dbWith(record());
    const tooMany: RateLimitStore = { increment: async () => 100_000 };
    const err = await authenticateBearer(db, `Bearer ${t.secret}`, { rateLimitStore: tooMany }).catch((e) => e);
    expect(err.status).toBe(429);
  });
});

describe("requireScope", () => {
  const ctx = { workspaceId: "w", tokenId: "t", tokenName: "n", scopes: ["read"], createdByUserId: null };
  it("allows granted scopes and forbids others", () => {
    expect(() => requireScope(ctx, "read")).not.toThrow();
    expect(() => requireScope(ctx, "drafts:write")).toThrowError(/drafts:write/);
    expect(() => requireScope(ctx, "activate")).toThrow();
  });
});
