import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { isContactsDedupEnabled } from "@/lib/contacts/config";
import { listContacts } from "@/lib/contacts/manage";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";

/**
 * People who have interacted with the workspace's accounts. Any member can read.
 * Query: assignedTo=me|unassigned|<userId>, status, consent, q, limit, cursor.
 */
export async function GET(request: Request) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const assignedTo = sp.get("assignedTo");
  const res = await listContacts(prisma, {
    workspaceId: ctx.workspaceId,
    assignedTo: assignedTo === "me" ? ctx.userId : assignedTo,
    status: sp.get("status"),
    consent: sp.get("consent"),
    q: sp.get("q"),
    identity: sp.get("identity"),
    limit: sp.get("limit"),
    cursor: sp.get("cursor"),
  });
  if (!res.ok) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
  // contactsEnabled lets the page explain an empty list when contact tracking is switched off.
  return NextResponse.json({ success: true, data: { ...res.value, contactsEnabled: isContactsDedupEnabled() } });
}
