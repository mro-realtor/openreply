const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const MAX_URI_LENGTH = 2000;

/**
 * Redirect URIs must be https, or http on a loopback address (native apps and
 * local tools). No fragments, no embedded credentials, no custom schemes.
 */
export function isValidRedirectUri(value: string): boolean {
  if (value.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Exact match. Loopback redirects may differ in port only, because native
 * clients pick a free port at run time (RFC 8252 section 7.3).
 */
export function redirectUriMatches(registered: readonly string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  let cand: URL;
  try {
    cand = new URL(candidate);
  } catch {
    return false;
  }
  if (!isLoopback(cand)) return false;
  return registered.some((entry) => {
    try {
      const reg = new URL(entry);
      return (
        isLoopback(reg) &&
        reg.hostname === cand.hostname &&
        reg.pathname === cand.pathname &&
        reg.search === cand.search
      );
    } catch {
      return false;
    }
  });
}
