import type { PrismaClient } from "@/app/generated/prisma/client";
import { buildPage, cursorWhere, decodeCursor, pageOrder, parseLimit } from "@/lib/api/pagination";
import { emitOutbound } from "@/lib/outbound/events";

type Db = PrismaClient;

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export const CONTACT_SELECT = {
  id: true,
  displayName: true,
  status: true,
  optedOutAt: true,
  humanTakeoverAt: true,
  lastDmSentAt: true,
  firstSeenAt: true,
  lastSeenAt: true,
  createdAt: true,
  consentStatus: true,
  consentUpdatedAt: true,
  consentSource: true,
  assignedToUserId: true,
  assignedAt: true,
  identities: { select: { platform: true, externalId: true, handle: true } },
} as const;

interface ContactRow {
  id: string;
  displayName: string | null;
  status: string;
  optedOutAt: Date | null;
  humanTakeoverAt: Date | null;
  lastDmSentAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  consentStatus: string;
  consentUpdatedAt: Date | null;
  consentSource: string | null;
  assignedToUserId: string | null;
  assignedAt: Date | null;
  identities: { platform: string; externalId: string; handle: string | null }[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toContactView(row: ContactRow) {
  return {
    id: row.id,
    displayName: row.displayName,
    status: row.status,
    optedOutAt: iso(row.optedOutAt),
    humanTakeover: row.humanTakeoverAt !== null,
    humanTakeoverAt: iso(row.humanTakeoverAt),
    lastDmSentAt: iso(row.lastDmSentAt),
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    consent: {
      status: row.consentStatus,
      updatedAt: iso(row.consentUpdatedAt),
      source: row.consentSource,
    },
    assignedToUserId: row.assignedToUserId,
    assignedAt: iso(row.assignedAt),
    identities: row.identities.map((i) => ({ platform: i.platform, externalId: i.externalId, handle: i.handle })),
  };
}

export interface ListInput {
  workspaceId: string;
  /** "unassigned" or a user id. */
  assignedTo?: string | null;
  status?: string | null;
  consent?: string | null;
  q?: string | null;
  limit?: string | number | null;
  cursor?: string | null;
}

const STATUSES = ["ACTIVE", "OPTED_OUT"];
const CONSENTS = ["UNKNOWN", "GRANTED", "WITHDRAWN"];

export async function listContacts(db: Db, input: ListInput) {
  if (input.status && !STATUSES.includes(input.status)) return fail(400, "status must be ACTIVE or OPTED_OUT");
  if (input.consent && !CONSENTS.includes(input.consent)) return fail(400, "consent must be UNKNOWN, GRANTED or WITHDRAWN");
  const q = input.q?.trim();
  if (q && q.length > 100) return fail(400, "q must be at most 100 characters");

  let limit: number;
  let cursor;
  try {
    limit = parseLimit(input.limit);
    cursor = decodeCursor(input.cursor);
  } catch {
    return fail(400, "Invalid limit or cursor");
  }

  const rows = await db.contact.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.assignedTo === "unassigned"
        ? { assignedToUserId: null }
        : input.assignedTo
          ? { assignedToUserId: input.assignedTo }
          : {}),
      ...(input.status ? { status: input.status as "ACTIVE" | "OPTED_OUT" } : {}),
      ...(input.consent ? { consentStatus: input.consent as "UNKNOWN" | "GRANTED" | "WITHDRAWN" } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" as const } },
              { identities: { some: { handle: { contains: q, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
      AND: [cursorWhere(cursor)],
    },
    select: CONTACT_SELECT,
    orderBy: pageOrder(),
    take: limit + 1,
  });
  const page = buildPage(rows, limit, (r) => r.createdAt);
  return ok({ items: page.items.map(toContactView), nextCursor: page.nextCursor });
}

export async function getContact(db: Db, workspaceId: string, id: string) {
  const row = await db.contact.findFirst({ where: { id, workspaceId }, select: CONTACT_SELECT });
  if (!row) return fail(404, "Contact not found");
  const events = await db.contactConsentEvent.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, status: true, source: true, note: true, recordedByUserId: true, createdAt: true },
  });
  return ok({
    ...toContactView(row),
    consentHistory: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  });
}

export async function recordConsent(
  db: Db,
  input: { workspaceId: string; contactId: string; status: unknown; source: unknown; note?: unknown; recordedByUserId?: string | null }
): Promise<Result<{ consentStatus: string; optedOut: boolean }>> {
  if (input.status !== "GRANTED" && input.status !== "WITHDRAWN") {
    return fail(400, "status must be GRANTED or WITHDRAWN");
  }
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (source.length < 1 || source.length > 60) return fail(400, "source is required (1 to 60 characters), for example manual, dm_reply or web_form");
  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string" || input.note.length > 500) return fail(400, "note must be text of at most 500 characters");
    note = input.note.trim() || null;
  }

  const status = input.status;
  const outcome = await db.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({
      where: { id: input.contactId, workspaceId: input.workspaceId },
      select: { id: true, status: true },
    });
    if (!contact) return null;
    const now = new Date();
    const withdraw = status === "WITHDRAWN";
    await tx.contact.update({
      where: { id: contact.id },
      data: {
        consentStatus: status,
        consentUpdatedAt: now,
        consentSource: source,
        // Withdrawing consent is a stop request: nothing more is sent to this person.
        ...(withdraw && contact.status !== "OPTED_OUT" ? { status: "OPTED_OUT" as const, optedOutAt: now } : {}),
      },
    });
    const event = await tx.contactConsentEvent.create({
      data: {
        workspaceId: input.workspaceId,
        contactId: contact.id,
        status,
        source,
        note,
        recordedByUserId: input.recordedByUserId ?? null,
      },
      select: { id: true },
    });
    return { eventId: event.id, newlyOptedOut: withdraw && contact.status !== "OPTED_OUT", optedOut: withdraw || contact.status === "OPTED_OUT" };
  });
  if (!outcome) return fail(404, "Contact not found");

  await emitOutbound(db, {
    workspaceId: input.workspaceId,
    type: "contact.consent_changed",
    dedupeKey: `contact:${input.contactId}:consent:${outcome.eventId}`,
    data: { contactId: input.contactId, consentStatus: status, source },
  });
  if (outcome.newlyOptedOut) {
    await emitOutbound(db, {
      workspaceId: input.workspaceId,
      type: "contact.opted_out",
      dedupeKey: `contact:${input.contactId}:opted_out:${outcome.eventId}`,
      data: { contactId: input.contactId },
    });
  }
  return ok({ consentStatus: status, optedOut: outcome.optedOut });
}

export async function assignContact(
  db: Db,
  input: { workspaceId: string; contactId: string; userId: string | null }
): Promise<Result<{ assignedToUserId: string | null; changed: boolean }>> {
  if (input.userId !== null) {
    const member = await db.workspaceMember.findFirst({
      where: { workspaceId: input.workspaceId, userId: input.userId },
      select: { id: true },
    });
    if (!member) return fail(400, "That person is not a member of this workspace");
  }
  const contact = await db.contact.findFirst({
    where: { id: input.contactId, workspaceId: input.workspaceId },
    select: { id: true, assignedToUserId: true },
  });
  if (!contact) return fail(404, "Contact not found");
  if (contact.assignedToUserId === input.userId) return ok({ assignedToUserId: input.userId, changed: false });

  await db.contact.update({
    where: { id: contact.id },
    data: { assignedToUserId: input.userId, assignedAt: input.userId ? new Date() : null },
  });
  await emitOutbound(db, {
    workspaceId: input.workspaceId,
    type: "contact.assigned",
    dedupeKey: `contact:${contact.id}:assigned:${Date.now()}`,
    data: { contactId: contact.id, assignedToUserId: input.userId, previousAssignedToUserId: contact.assignedToUserId },
  });
  return ok({ assignedToUserId: input.userId, changed: true });
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}
