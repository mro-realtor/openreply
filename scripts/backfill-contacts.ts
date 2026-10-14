/**
 * Usage (dry run, the default):   npx tsx scripts/backfill-contacts.ts
 * Apply for real:                 npx tsx scripts/backfill-contacts.ts --apply
 * One workspace only:             npx tsx scripts/backfill-contacts.ts --workspace <id>
 * Only changes Contact tables and DmLog.contactId. Run against a copy first.
 */
import { prisma } from "../lib/db/client";
import { backfillContactsFromDmLog } from "../lib/contacts/backfill";

async function main() {
  const args = process.argv.slice(2);
  const wsIdx = args.indexOf("--workspace");
  const result = await backfillContactsFromDmLog(prisma, {
    dryRun: !args.includes("--apply"),
    workspaceId: wsIdx >= 0 ? args[wsIdx + 1] : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}
main().finally(() => prisma.$disconnect());
