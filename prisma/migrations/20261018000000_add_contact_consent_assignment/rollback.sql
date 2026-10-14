-- Manual rollback for 20261018000000_add_contact_consent_assignment. Not run automatically
-- (Prisma ignores this file). Removes only what the migration added.
-- Consent history and assignments are lost; export them first if you need them.
DROP TABLE IF EXISTS "ContactConsentEvent";
ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_assignedToUserId_fkey";
DROP INDEX IF EXISTS "Contact_workspaceId_assignedToUserId_idx";
ALTER TABLE "Contact" DROP COLUMN IF EXISTS "assignedAt",
DROP COLUMN IF EXISTS "assignedToUserId",
DROP COLUMN IF EXISTS "consentSource",
DROP COLUMN IF EXISTS "consentStatus",
DROP COLUMN IF EXISTS "consentUpdatedAt";
DROP TYPE IF EXISTS "ConsentStatus";
