-- Manual rollback for 20261016000000_add_ig_connection_health. Not run
-- automatically (Prisma ignores this file). Drops only the columns it added;
-- accessToken and tokenExpiresAt are untouched.
DROP INDEX IF EXISTS "InstagramAccount_connectionStatus_idx";
ALTER TABLE "InstagramAccount"
  DROP COLUMN IF EXISTS "connectionStatus",
  DROP COLUMN IF EXISTS "needsReconnectReason",
  DROP COLUMN IF EXISTS "connectedByUserId",
  DROP COLUMN IF EXISTS "grantedScopes",
  DROP COLUMN IF EXISTS "lastRefreshAt",
  DROP COLUMN IF EXISTS "nextRefreshAt",
  DROP COLUMN IF EXISTS "refreshAttempts",
  DROP COLUMN IF EXISTS "lastRefreshError",
  DROP COLUMN IF EXISTS "refreshLockedUntil",
  DROP COLUMN IF EXISTS "webhookCheckedAt",
  DROP COLUMN IF EXISTS "webhookError",
  DROP COLUMN IF EXISTS "lastWebhookAt",
  DROP COLUMN IF EXISTS "lastAlertKind",
  DROP COLUMN IF EXISTS "lastAlertAt";
DROP TYPE IF EXISTS "IgConnectionStatus";
