/**
 * Secret redaction for audit logs, error messages and API responses.
 */

const SENSITIVE_KEY =
  /token|secret|password|passwd|authorization|api[-_]?key|cookie|encryption|credential/i;

const SECRET_PATTERNS: RegExp[] = [
  /orp_[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\bIG[A-Za-z0-9]{40,}\b/g,
  /\bEA[A-Za-z0-9]{40,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bre_[A-Za-z0-9_]{20,}\b/g,
];

export const REDACTED = "[redacted]";

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out as T;
  }
  return value;
}
