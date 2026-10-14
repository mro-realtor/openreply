-- Manual rollback for 20261014120000_add_oauth. Not run automatically
-- (Prisma ignores this file). Removes only what the migration added.
-- OAuth-issued access tokens stay in "ApiToken" until the column is dropped;
-- revoke them first if you want them dead rather than merely un-linked:
--   UPDATE "ApiToken" SET "revokedAt" = now() WHERE "grantId" IS NOT NULL AND "revokedAt" IS NULL;
DROP TABLE IF EXISTS "OAuthRefreshToken";
DROP TABLE IF EXISTS "OAuthAuthorizationCode";
DROP TABLE IF EXISTS "OAuthGrant";
DROP TABLE IF EXISTS "OAuthAuthorizationRequest";
DROP TABLE IF EXISTS "OAuthClient";
DROP INDEX IF EXISTS "ApiToken_grantId_idx";
ALTER TABLE "ApiToken" DROP COLUMN IF EXISTS "grantId";
