import type { PrismaClient } from "@/app/generated/prisma/client";

export interface BackfillResult {
  dryRun: boolean;
  identitiesToCreate: number;
  contactsCreated: number;
  logsLinked: number;
}

/**
 * Links existing DmLog rows to Contacts, one Contact per (workspace, commenterId).
 * Idempotent and resumable: it only touches rows whose contactId is still NULL,
 * and never changes status, message text or send history. Dry run by default.
 */
export async function backfillContactsFromDmLog(
  db: PrismaClient,
  opts: { workspaceId?: string; dryRun?: boolean; batchSize?: number } = {}
): Promise<BackfillResult> {
  const dryRun = opts.dryRun ?? true;
  const batchSize = opts.batchSize ?? 500;
  const result: BackfillResult = { dryRun, identitiesToCreate: 0, contactsCreated: 0, logsLinked: 0 };
  const seen = new Set<string>();

  for (;;) {
    const groups = await db.dmLog.groupBy({
      by: ["workspaceId", "commenterId"],
      where: { contactId: null, ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) },
      orderBy: [{ workspaceId: "asc" }, { commenterId: "asc" }],
      take: batchSize,
    });
    const fresh = groups.filter((g) => !seen.has(`${g.workspaceId}:${g.commenterId}`));
    if (fresh.length === 0) break;

    for (const g of fresh) {
      seen.add(`${g.workspaceId}:${g.commenterId}`);
      result.identitiesToCreate++;
      if (dryRun) continue;

      const logs = await db.dmLog.findMany({
        where: { workspaceId: g.workspaceId, commenterId: g.commenterId, contactId: null },
        select: { commenterName: true, status: true, dmSentAt: true, createdAt: true },
      });
      const lastSent = logs
        .filter((l) => l.status === "SENT" && l.dmSentAt)
        .map((l) => l.dmSentAt as Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const firstSeen = logs.map((l) => l.createdAt).sort((a, b) => a.getTime() - b.getTime())[0];
      const name = logs.find((l) => l.commenterName)?.commenterName ?? null;

      const where = {
        workspaceId_platform_externalId: {
          workspaceId: g.workspaceId,
          platform: "INSTAGRAM" as const,
          externalId: g.commenterId,
        },
      };
      let identity = await db.socialIdentity.findUnique({ where });
      if (!identity) {
        const contact = await db.contact.create({
          data: {
            workspaceId: g.workspaceId,
            displayName: name,
            firstSeenAt: firstSeen,
            lastSeenAt: new Date(),
            lastDmSentAt: lastSent ?? null,
            identities: {
              create: {
                workspaceId: g.workspaceId,
                platform: "INSTAGRAM",
                externalId: g.commenterId,
                handle: name,
              },
            },
          },
          select: { id: true, identities: { select: { id: true, contactId: true } } },
        });
        result.contactsCreated++;
        identity = { ...contact.identities[0] } as never;
      } else if (lastSent) {
        await db.contact.updateMany({
          where: {
            id: identity.contactId,
            OR: [{ lastDmSentAt: null }, { lastDmSentAt: { lt: lastSent } }],
          },
          data: { lastDmSentAt: lastSent },
        });
      }
      const linked = await db.dmLog.updateMany({
        where: { workspaceId: g.workspaceId, commenterId: g.commenterId, contactId: null },
        data: { contactId: identity!.contactId },
      });
      result.logsLinked += linked.count;
    }
  }
  return result;
}
