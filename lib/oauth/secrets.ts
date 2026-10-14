import { randomBytes } from "node:crypto";
import { hashApiToken } from "@/lib/api/tokens";

export const REFRESH_PREFIX = "orr_";
const REFRESH_PATTERN = /^orr_[A-Za-z0-9_-]{43}$/;

export function generateRefreshToken(): { secret: string; hash: string } {
  const secret = `${REFRESH_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { secret, hash: hashApiToken(secret) };
}

export function isWellFormedRefreshToken(value: string): boolean {
  return REFRESH_PATTERN.test(value);
}

export function generateAuthorizationCode(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashApiToken(secret) };
}

export function generateRequestId(): string {
  return randomBytes(32).toString("base64url");
}

export function generateClientId(): string {
  return `orcl_${randomBytes(18).toString("base64url")}`;
}

export { hashApiToken as hashSecret };
