-- Additive only. Rollback: see rollback.sql in this folder.
-- Existing accounts become ACTIVE with empty health history; the first
-- maintenance run fills in the schedule from tokenExpiresAt.

-- CreateEnum
CREATE TYPE "IgConnectionStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'NEEDS_RECONNECT');

-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN     "connectionStatus" "IgConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "needsReconnectReason" TEXT,
ADD COLUMN     "connectedByUserId" TEXT,
ADD COLUMN     "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastRefreshAt" TIMESTAMP(3),
ADD COLUMN     "nextRefreshAt" TIMESTAMP(3),
ADD COLUMN     "refreshAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastRefreshError" TEXT,
ADD COLUMN     "refreshLockedUntil" TIMESTAMP(3),
ADD COLUMN     "webhookCheckedAt" TIMESTAMP(3),
ADD COLUMN     "webhookError" TEXT,
ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "lastAlertKind" TEXT,
ADD COLUMN     "lastAlertAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InstagramAccount_connectionStatus_idx" ON "InstagramAccount"("connectionStatus");
