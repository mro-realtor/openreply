-- Manual rollback for 20261014000000_add_api_access. Not run automatically
-- (Prisma ignores this file). Safe: only removes what the migration added.
-- After running it, also delete the row for this migration from
-- "_prisma_migrations" if you want Prisma to treat it as never applied.
DROP TABLE IF EXISTS "IdempotencyKey";
DROP TABLE IF EXISTS "ApiToken";
DROP TABLE IF EXISTS "AuditLog";
ALTER TABLE "Automation" DROP COLUMN IF EXISTS "draftConfig";
ALTER TABLE "Automation" DROP COLUMN IF EXISTS "isDraft";
