import { describe, expect, it } from "vitest";
import { hashRequest, validateIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import type { ApiContext, Db } from "@/lib/api/types";

interface Row {
  id: string;
  apiTokenId: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

function fakeDb() {
  const rows: Row[] = [];
  let n = 0;
  const db = {
    idempotencyKey: {
      async create({ data }: { data: Omit<Row, "id" | "createdAt"> }) {
        if (rows.some((r) => r.apiTokenId === data.apiTokenId && r.key === data.key)) {
          throw new Error("unique constraint");
        }
        const row = { ...data, id: `r${++n}`, createdAt: new Date() };
        rows.push(row);
        return { id: row.id };
      },
      async findUnique({ where }: { where: { apiTokenId_key: { apiTokenId: string; key: string } } }) {
        const k = where.apiTokenId_key;
        return rows.find((r) => r.apiTokenId === k.apiTokenId && r.key === k.key) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
        Object.assign(rows.find((r) => r.id === where.id)!, data);
        return {};
      },
      async delete({ where }: { where: { id: string } }) {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i >= 0) rows.splice(i, 1);
        return {};
      },
    },
  } as unknown as Db;
  return { db, rows };
}

const ctx: ApiContext = { workspaceId: "w", tokenId: "t1", tokenName: "n", scopes: ["drafts:write"], createdByUserId: null };

describe("idempotency", () => {
  it("validates key shape", () => {
    expect(validateIdempotencyKey(null)).toBeNull();
    expect(validateIdempotencyKey("abc12345")).toBe("abc12345");
    expect(() => validateIdempotencyKey("short")).toThrow();
    expect(() => validateIdempotencyKey("has spaces in it")).toThrow();
  });

  it("hashes bodies independent of key order", () => {
    expect(hashRequest("op", { a: 1, b: { c: 2, d: 3 } })).toBe(hashRequest("op", { b: { d: 3, c: 2 }, a: 1 }));
    expect(hashRequest("op", { a: 1 })).not.toBe(hashRequest("op", { a: 2 }));
    expect(hashRequest("op1", { a: 1 })).not.toBe(hashRequest("op2", { a: 1 }));
  });

  it("runs without a key every time", async () => {
    const { db } = fakeDb();
    let runs = 0;
    const exec = async () => ({ status: 201, body: { n: ++runs } });
    await withIdempotency(db, ctx, null, "op", {}, exec);
    await withIdempotency(db, ctx, null, "op", {}, exec);
    expect(runs).toBe(2);
  });

  it("executes once and replays the stored response for the same key and body", async () => {
    const { db } = fakeDb();
    let runs = 0;
    const exec = async () => ({ status: 201, body: { id: `c${++runs}` } });
    const first = await withIdempotency(db, ctx, "key-12345", "op", { a: 1 }, exec);
    const second = await withIdempotency(db, ctx, "key-12345", "op", { a: 1 }, exec);
    expect(runs).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ replayed: true, status: 201, body: { id: "c1" } });
  });

  it("rejects the same key with a different body", async () => {
    const { db } = fakeDb();
    const exec = async () => ({ status: 201, body: {} });
    await withIdempotency(db, ctx, "key-12345", "op", { a: 1 }, exec);
    const err = await withIdempotency(db, ctx, "key-12345", "op", { a: 2 }, exec).catch((e) => e);
    expect(err.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(err.status).toBe(422);
  });

  it("scopes keys per token", async () => {
    const { db } = fakeDb();
    let runs = 0;
    const exec = async () => ({ status: 201, body: { n: ++runs } });
    await withIdempotency(db, ctx, "key-12345", "op", {}, exec);
    await withIdempotency(db, { ...ctx, tokenId: "t2" }, "key-12345", "op", {}, exec);
    expect(runs).toBe(2);
  });

  it("runs only once when two identical requests arrive together", async () => {
    const { db } = fakeDb();
    let runs = 0;
    const slow = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 20));
      return { status: 201, body: { ok: true } };
    };
    const results = await Promise.allSettled([
      withIdempotency(db, ctx, "key-12345", "op", { a: 1 }, slow),
      withIdempotency(db, ctx, "key-12345", "op", { a: 1 }, slow),
    ]);
    expect(runs).toBe(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe("IDEMPOTENCY_IN_PROGRESS");
  });

  it("frees the key when the operation fails so the client can retry", async () => {
    const { db, rows } = fakeDb();
    await withIdempotency(db, ctx, "key-12345", "op", {}, async () => {
      throw new Error("boom");
    }).catch(() => {});
    expect(rows).toHaveLength(0);
    const retry = await withIdempotency(db, ctx, "key-12345", "op", {}, async () => ({ status: 201, body: { ok: 1 } }));
    expect(retry.replayed).toBe(false);
  });
});
