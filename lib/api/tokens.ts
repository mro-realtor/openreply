import { createHash, randomBytes } from "node:crypto";

/**
 * API token format: "orp_" followed by 43 base64url characters (256 bits).
 * Only the SHA-256 hash is persisted. SHA-256 (not a slow password hash) is
 * correct here because the secret is high entropy random data, not a password.
 */

export const TOKEN_PREFIX = "orp_";
const SECRET_BYTES = 32;
const TOKEN_PATTERN = /^orp_[A-Za-z0-9_-]{43}$/;

export const MAX_TOKEN_LIFETIME_DAYS = 90;
export const DEFAULT_TOKEN_LIFETIME_DAYS = 30;

export interface GeneratedToken {
  /** Full secret. Show it to the user once, never store or log it. */
  secret: string;
  hash: string;
  /** Short non-secret label, e.g. "orp_AbCd1234". */
  displayPrefix: string;
}

export function hashApiToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateApiToken(): GeneratedToken {
  const secret = `${TOKEN_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return {
    secret,
    hash: hashApiToken(secret),
    displayPrefix: secret.slice(0, TOKEN_PREFIX.length + 8),
  };
}

export function isWellFormedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** Extracts the bearer secret from an Authorization header, or null. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export interface TokenRecord {
  revokedAt: Date | null;
  expiresAt: Date;
}

export type TokenState = "active" | "revoked" | "expired";

export function getTokenState(record: TokenRecord, now = new Date()): TokenState {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function clampLifetimeDays(requested: number | undefined): number {
  const value = requested ?? DEFAULT_TOKEN_LIFETIME_DAYS;
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), MAX_TOKEN_LIFETIME_DAYS);
}
