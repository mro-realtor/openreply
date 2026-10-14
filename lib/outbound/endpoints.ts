import type { PrismaClient } from "@/app/generated/prisma/client";
import { allowedPrivateHosts, isKnownEventType } from "./config";
import { generateSecret } from "./signing";
import { assertPublicHost, validateWebhookUrl } from "./url-guard";

type Db = PrismaClient;

export const MAX_ENDPOINTS_PER_WORKSPACE = 10;

export interface EndpointRow {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
}

export const ENDPOINT_SELECT = {
  id: true,
  name: true,
  url: true,
  eventTypes: true,
  isActive: true,
  disabledReason: true,
  consecutiveFailures: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  createdAt: true,
} as const;

/** Receiver URLs often carry a secret path, so only the origin is ever shown back. */
export function toEndpointView(row: EndpointRow) {
  let urlPreview = "(invalid)";
  try {
    urlPreview = `${new URL(row.url).origin}/...`;
  } catch {
    /* keep placeholder */
  }
  const { url: _url, ...rest } = row;
  void _url;
  return { ...rest, urlPreview };
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

async function checkUrl(raw: string): Promise<Result<string>> {
  const allowedHosts = allowedPrivateHosts();
  const check = validateWebhookUrl(raw, { allowedHosts });
  if (!check.ok) return { ok: false, status: 400, error: check.reason };
  try {
    await assertPublicHost(check.url, { allowedHosts });
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : "Destination not reachable" };
  }
  return { ok: true, value: check.url.toString() };
}

function checkEvents(types: unknown): Result<string[]> {
  if (types === undefined) return { ok: true, value: [] };
  if (!Array.isArray(types) || !types.every((t) => typeof t === "string" && isKnownEventType(t))) {
    return { ok: false, status: 400, error: "eventTypes must be a list of known event names" };
  }
  return { ok: true, value: [...new Set(types as string[])] };
}

function checkName(name: unknown): Result<string> {
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80) {
    return { ok: false, status: 400, error: "name must be 1 to 80 characters" };
  }
  return { ok: true, value: name.trim() };
}

export async function createEndpoint(
  db: Db,
  input: { workspaceId: string; name: unknown; url: unknown; eventTypes?: unknown; encrypt: (plain: string) => string }
): Promise<Result<{ endpoint: ReturnType<typeof toEndpointView>; secret: string }>> {
  const name = checkName(input.name);
  if (!name.ok) return name;
  if (typeof input.url !== "string") return { ok: false, status: 400, error: "url is required" };
  const events = checkEvents(input.eventTypes);
  if (!events.ok) return events;
  const url = await checkUrl(input.url);
  if (!url.ok) return url;

  const count = await db.webhookEndpoint.count({ where: { workspaceId: input.workspaceId } });
  if (count >= MAX_ENDPOINTS_PER_WORKSPACE) {
    return { ok: false, status: 409, error: `At most ${MAX_ENDPOINTS_PER_WORKSPACE} endpoints per workspace` };
  }
  const secret = generateSecret();
  const row = await db.webhookEndpoint.create({
    data: {
      workspaceId: input.workspaceId,
      name: name.value,
      url: url.value,
      eventTypes: events.value,
      secretEncrypted: input.encrypt(secret),
    },
    select: ENDPOINT_SELECT,
  });
  return { ok: true, value: { endpoint: toEndpointView(row), secret } };
}

export async function updateEndpoint(
  db: Db,
  input: {
    workspaceId: string;
    id: string;
    patch: { name?: unknown; url?: unknown; eventTypes?: unknown; isActive?: unknown; rotateSecret?: unknown };
    encrypt: (plain: string) => string;
  }
): Promise<Result<{ endpoint: ReturnType<typeof toEndpointView>; secret?: string }>> {
  const existing = await db.webhookEndpoint.findFirst({
    where: { id: input.id, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!existing) return { ok: false, status: 404, error: "Endpoint not found" };

  const data: Record<string, unknown> = {};
  const p = input.patch;
  if (p.name !== undefined) {
    const n = checkName(p.name);
    if (!n.ok) return n;
    data.name = n.value;
  }
  if (p.url !== undefined) {
    if (typeof p.url !== "string") return { ok: false, status: 400, error: "url must be a string" };
    const u = await checkUrl(p.url);
    if (!u.ok) return u;
    data.url = u.value;
  }
  if (p.eventTypes !== undefined) {
    const e = checkEvents(p.eventTypes);
    if (!e.ok) return e;
    data.eventTypes = e.value;
  }
  if (p.isActive !== undefined) {
    if (typeof p.isActive !== "boolean") return { ok: false, status: 400, error: "isActive must be true or false" };
    data.isActive = p.isActive;
    if (p.isActive) {
      data.disabledReason = null;
      data.consecutiveFailures = 0;
    } else {
      data.disabledReason = "Switched off by a person";
    }
  }
  let secret: string | undefined;
  if (p.rotateSecret === true) {
    secret = generateSecret();
    data.secretEncrypted = input.encrypt(secret);
  }
  const row = await db.webhookEndpoint.update({ where: { id: input.id }, data, select: ENDPOINT_SELECT });
  return { ok: true, value: { endpoint: toEndpointView(row), secret } };
}

export async function replayDelivery(db: Db, workspaceId: string, deliveryId: string): Promise<boolean> {
  const res = await db.webhookDelivery.updateMany({
    where: { id: deliveryId, endpoint: { workspaceId } },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lockedUntil: null, lastError: null },
  });
  return res.count === 1;
}
