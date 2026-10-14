import dns from "node:dns/promises";
import { isIP } from "node:net";

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

function isPrivateV6(raw: string): boolean {
  const ip = raw.toLowerCase();
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("::ffff:")) {
    const rest = ip.slice(7);
    if (rest.includes(".")) return isPrivateV4(rest);
    const g = rest.split(":");
    if (g.length === 2) {
      const hi = parseInt(g[0], 16);
      const lo = parseInt(g[1], 16);
      if (Number.isNaN(hi) || Number.isNaN(lo)) return true;
      return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return true;
  }
  const first = ip.startsWith("::") ? 0 : parseInt(ip.split(":")[0] || "0", 16);
  if (Number.isNaN(first)) return true;
  return (
    (first >= 0xfc00 && first <= 0xfdff) || // unique local
    (first >= 0xfe80 && first <= 0xfebf) || // link-local
    first >= 0xff00 // multicast
  );
}

/** True for loopback, private, link-local, metadata, multicast and unparseable addresses. */
export function isPrivateIp(ip: string): boolean {
  const clean = stripBrackets(ip);
  const kind = isIP(clean);
  if (kind === 4) return isPrivateV4(clean);
  if (kind === 6) return isPrivateV6(clean);
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Static checks on a destination URL. Hosts listed in `allowedHosts` (an
 * explicit operator choice) may use http and private addresses.
 */
export function validateWebhookUrl(raw: string, opts: { allowedHosts?: string[] } = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  const host = stripBrackets(url.hostname).toLowerCase();
  const allowed = (opts.allowedHosts ?? []).includes(host);

  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  if (url.protocol !== "https:" && !(allowed && url.protocol === "http:")) {
    return { ok: false, reason: "Only https URLs are allowed" };
  }
  if (!allowed) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      return { ok: false, reason: "Local and internal hostnames are not allowed" };
    }
    if (isIP(host) && isPrivateIp(host)) {
      return { ok: false, reason: "Private and loopback addresses are not allowed" };
    }
  }
  return { ok: true, url };
}

type Lookup = (host: string) => Promise<{ address: string }[]>;

/**
 * Resolves the hostname and rejects it if ANY address is private, so a public
 * looking name cannot point at the internal network. Run right before sending.
 */
export async function assertPublicHost(
  url: URL,
  opts: { allowedHosts?: string[]; lookup?: Lookup } = {}
): Promise<void> {
  const host = stripBrackets(url.hostname).toLowerCase();
  if ((opts.allowedHosts ?? []).includes(host)) return;
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Destination resolves to a private address");
    return;
  }
  const lookup: Lookup = opts.lookup ?? ((h) => dns.lookup(h, { all: true }));
  const addrs = await lookup(host);
  if (addrs.length === 0) throw new Error("Destination did not resolve");
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("Destination resolves to a private address");
  }
}
