import { DEFAULT_SCOPES, isIssuableScope, type Scope } from "@/lib/api/scopes";
import { OAuthError } from "@/lib/oauth/errors";

/**
 * Parses a space separated scope parameter. Reserved or unknown scopes are an
 * error, never silently dropped, so a client cannot believe it holds more
 * access than it was given. No scope means the default (read only).
 */
export function parseRequestedScopes(raw: string | null | undefined): Scope[] {
  const parts = (raw ?? "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [...DEFAULT_SCOPES];
  const rejected = parts.filter((scope) => !isIssuableScope(scope));
  if (rejected.length > 0) {
    throw new OAuthError("invalid_scope", `Scopes not available: ${rejected.join(", ")}`);
  }
  return Array.from(new Set(parts)) as Scope[];
}
