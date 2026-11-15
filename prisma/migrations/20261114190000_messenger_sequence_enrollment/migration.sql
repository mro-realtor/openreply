CREATE TABLE "MessengerSequenceEnrollment" (
  "id" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "interactionAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "steps" JSONB NOT NULL,
  "nextStep" INTEGER NOT NULL DEFAULT 0,
  "status" "SequenceStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessengerSequenceEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MessengerSequenceEnrollment_sequenceId_pageId_recipientId_key" ON "MessengerSequenceEnrollment"("sequenceId", "pageId", "recipientId");
CREATE INDEX "MessengerSequenceEnrollment_status_dueAt_idx" ON "MessengerSequenceEnrollment"("status", "dueAt");
CREATE INDEX "MessengerSequenceEnrollment_pageId_recipientId_status_idx" ON "MessengerSequenceEnrollment"("pageId", "recipientId", "status");
ALTER TABLE "MessengerSequenceEnrollment" ADD CONSTRAINT "MessengerSequenceEnrollment_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "MessengerAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerSequenceEnrollment" ADD CONSTRAINT "MessengerSequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerSequenceEnrollment" ADD CONSTRAINT "MessengerSequenceEnrollment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "MessengerPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
