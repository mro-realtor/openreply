import { apiErrors } from "@/lib/api/errors";
import type { ApiContext, Db } from "@/lib/api/types";
import {
  getContact,
  listContactHistory,
  listContacts,
  type Result,
  type toContactView,
} from "@/lib/contacts/manage";

/**
 * Read-only contact access for API tokens and MCP. Everything is scoped to the token's
 * workspace and nothing here can send a message, change a contact, or merge two people.
 *
 * Consent is reported per channel. The consent stored today is permission to message
 * the person on Instagram DM only. SMS and phone-call consent are separate things,
 * are not stored here yet, and must never be inferred from it.
 */
type ContactView = ReturnType<typeof toContactView>;

export function toApiContact(view: ContactView) {
  return {
    id: view.id,
    displayName: view.displayName,
    followUpState: view.followUpState,
    assignedToUserId: view.assignedToUserId,
    assignedAt: view.assignedAt,
    humanTakeover: { active: view.humanTakeover, at: view.humanTakeoverAt },
    optOut: { optedOut: view.status === "OPTED_OUT", at: view.optedOutAt, channel: "instagram_dm" as const },
    consent: {
      instagramDm: { status: view.consent.status, updatedAt: view.consent.updatedAt, source: view.consent.source },
      sms: { status: "NOT_TRACKED" as const },
      voice: { status: "NOT_TRACKED" as const },
    },
    identities: view.identities,
    firstSeenAt: view.firstSeenAt,
    lastSeenAt: view.lastSeenAt,
    lastDmSentAt: view.lastDmSentAt,
  };
}

function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw result.status === 404 ? apiErrors.notFound("Contact") : apiErrors.validation(result.error);
}

export async function listContactsForApi(
  db: Db,
  ctx: ApiContext,
  params: {
    q?: string | null;
    status?: string | null;
    consent?: string | null;
    assignedTo?: string | null;
    identity?: string | null;
    limit?: string | number | null;
    cursor?: string | null;
  }
) {
  const page = unwrap(await listContacts(db, { workspaceId: ctx.workspaceId, ...params }));
  return { items: page.items.map(toApiContact), nextCursor: page.nextCursor };
}

export async function getContactForApi(db: Db, ctx: ApiContext, id: string) {
  const detail = unwrap(await getContact(db, ctx.workspaceId, id));
  const { consentHistory, ...view } = detail;
  return {
    ...toApiContact(view),
    consentHistory: consentHistory.map((e) => ({
      id: e.id,
      channel: "instagram_dm" as const,
      status: e.status,
      source: e.source,
      note: e.note,
      recordedByUserId: e.recordedByUserId,
      createdAt: e.createdAt,
    })),
  };
}

export async function listContactHistoryForApi(
  db: Db,
  ctx: ApiContext,
  id: string,
  params: { limit?: string | number | null; cursor?: string | null }
) {
  return unwrap(
    await listContactHistory(db, { workspaceId: ctx.workspaceId, contactId: id, includeContent: false, ...params })
  );
}
