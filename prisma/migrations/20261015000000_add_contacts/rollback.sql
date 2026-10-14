-- Manual rollback for 20261015000000_add_contacts. Not run automatically
-- (Prisma ignores this file). Removes only what the migration added.
-- Contact data (opt-outs, takeovers) is lost; export it first if you need it.
ALTER TABLE "DmLog" DROP CONSTRAINT IF EXISTS "DmLog_contactId_fkey";
DROP INDEX IF EXISTS "DmLog_contactId_idx";
ALTER TABLE "DmLog" DROP COLUMN IF EXISTS "contactId";
DROP TABLE IF EXISTS "SocialIdentity";
DROP TABLE IF EXISTS "Contact";
DROP TYPE IF EXISTS "ContactStatus";
DROP TYPE IF EXISTS "SocialPlatform";
