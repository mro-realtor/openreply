import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canActOnContact, type ContactAction } from "@/lib/contacts/access";
import { assignContact, getContact, recordConsent } from "@/lib/contacts/manage";
import { setHumanTakeover, setOptOut } from "@/lib/contacts/service";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";
type RouteProps = { params: Promise<{ id: string }> };

const err = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function GET(_request: Request, { params }: RouteProps) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return err("Unauthorized", 401);
  const { id } = await params;
  const res = await getContact(prisma, ctx.workspaceId, id);
  if (!res.ok) return err(res.error, res.status);
  return NextResponse.json({ success: true, data: res.value });
}

/**
 * Body (any combination):
 *  { assignedToUserId: string | null }          owners and admins
 *  { consent: { status, source, note? } }       admins, or the member it is assigned to
 *  { optedOut: true }                           admins, or the member it is assigned to
 *  { optedOut: false }                          owners and admins only
 *  { humanTakeover: boolean }                   admins, or the member it is assigned to
 * Nothing here sends a message to the person.
 */
export async function PATCH(request: Request, { params }: RouteProps) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return err("Unauthorized", 401);
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return err("Invalid JSON", 400);

  const keys = ["assignedToUserId", "consent", "optedOut", "humanTakeover"].filter((k) => k in body);
  if (keys.length === 0) return err("Nothing to change", 400);

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, assignedToUserId: true },
  });
  if (!contact) return err("Contact not found", 404);

  const allowed = (action: ContactAction) =>
    canActOnContact({ role: ctx.role, userId: ctx.userId, assignedToUserId: contact.assignedToUserId, action });

  if ("assignedToUserId" in body && !allowed("assign")) return err("Forbidden", 403);
  if ("consent" in body && !allowed("consent")) return err("Forbidden", 403);
  if ("optedOut" in body && !allowed(body.optedOut === false ? "optIn" : "optOut")) return err("Forbidden", 403);
  if ("humanTakeover" in body && !allowed("takeover")) return err("Forbidden", 403);

  if ("assignedToUserId" in body) {
    const v = body.assignedToUserId;
    if (v !== null && typeof v !== "string") return err("assignedToUserId must be a user id or null", 400);
    const res = await assignContact(prisma, { workspaceId: ctx.workspaceId, contactId: id, userId: v });
    if (!res.ok) return err(res.error, res.status);
  }
  if ("consent" in body) {
    const c = body.consent as Record<string, unknown> | null;
    if (!c || typeof c !== "object") return err("consent must be an object", 400);
    const res = await recordConsent(prisma, {
      workspaceId: ctx.workspaceId,
      contactId: id,
      status: c.status,
      source: c.source,
      note: c.note,
      recordedByUserId: ctx.userId,
    });
    if (!res.ok) return err(res.error, res.status);
  }
  if ("optedOut" in body) {
    if (typeof body.optedOut !== "boolean") return err("optedOut must be true or false", 400);
    await setOptOut(prisma, ctx.workspaceId, id, body.optedOut);
  }
  if ("humanTakeover" in body) {
    if (typeof body.humanTakeover !== "boolean") return err("humanTakeover must be true or false", 400);
    await setHumanTakeover(prisma, ctx.workspaceId, id, body.humanTakeover);
  }

  const res = await getContact(prisma, ctx.workspaceId, id);
  if (!res.ok) return err(res.error, res.status);
  return NextResponse.json({ success: true, data: res.value });
}
