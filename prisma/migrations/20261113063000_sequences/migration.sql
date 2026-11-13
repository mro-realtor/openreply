-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('PENDING', 'SENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "sequenceId" TEXT;

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceEnrollment" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT,
    "interactionAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "steps" JSONB NOT NULL,
    "nextStep" INTEGER NOT NULL DEFAULT 0,
    "status" "SequenceStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sequence_workspaceId_idx" ON "Sequence"("workspaceId");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_status_dueAt_idx" ON "SequenceEnrollment"("status", "dueAt");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_instagramAccountId_recipientId_status_idx" ON "SequenceEnrollment"("instagramAccountId", "recipientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceEnrollment_sequenceId_instagramAccountId_recipientI_key" ON "SequenceEnrollment"("sequenceId", "instagramAccountId", "recipientId");

-- CreateIndex
CREATE INDEX "Automation_sequenceId_idx" ON "Automation"("sequenceId");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

