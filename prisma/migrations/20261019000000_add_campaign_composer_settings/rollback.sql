-- Manual rollback for 20261019000000_add_campaign_composer_settings. Not run automatically
-- (Prisma ignores this file). Removes only what the migration added.
-- The three settings are lost for every campaign; campaigns themselves are untouched.
ALTER TABLE "Automation" DROP CONSTRAINT IF EXISTS "Automation_defaultAssigneeUserId_fkey";
ALTER TABLE "Automation" DROP COLUMN IF EXISTS "defaultAssigneeUserId",
DROP COLUMN IF EXISTS "followGateStrict",
DROP COLUMN IF EXISTS "textOnly";
