import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

/**
 * Header value: `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">`.
 * The timestamp is part of the signed text, so a captured request cannot be
 * replayed later (receivers should reject old timestamps, see verifySignature).
 */
export function signPayload(secret: string, timestampSec: number, body: string): string {
  const v1 = createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
  return `t=${timestampSec},v1=${v1}`;
}

export function verifySignature(input: {
  secret: string;
  header: string | null | undefined;
  body: string;
  toleranceSec?: number;
  nowMs?: number;
}): boolean {
  if (!input.header) return false;
  const parts = input.header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const candidates = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || candidates.length === 0) return false;

  const tolerance = input.toleranceSec ?? 300;
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - ts) > tolerance) return false;

  const expected = Buffer.from(
    createHmac("sha256", input.secret).update(`${ts}.${input.body}`).digest("hex"),
    "utf8"
  );
  return candidates.some((c) => {
    const given = Buffer.from(c, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
