import { createHash, timingSafeEqual } from "node:crypto";

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
/** SHA-256 digests are 32 bytes, which is always 43 base64url characters. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(value: string): boolean {
  return CHALLENGE_PATTERN.test(value);
}

export function isValidCodeVerifier(value: string): boolean {
  return VERIFIER_PATTERN.test(value);
}

/** Only S256 is supported; "plain" is not allowed in OAuth 2.1. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
