-- Additive only. Rollback: see rollback.sql in this folder.
-- Existing contacts start with consent UNKNOWN and no assignee.

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'GRANTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "consentSource" TEXT,
ADD COLUMN     "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "consentUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ContactConsentEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactConsentEvent_contactId_createdAt_idx" ON "ContactConsentEvent"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactConsentEvent_workspaceId_idx" ON "ContactConsentEvent"("workspaceId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_assignedToUserId_idx" ON "Contact"("workspaceId", "assignedToUserId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsentEvent" ADD CONSTRAINT "ContactConsentEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
