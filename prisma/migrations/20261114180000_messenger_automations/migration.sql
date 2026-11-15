CREATE TABLE "MessengerAutomation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keywords" TEXT[] NOT NULL,
  "reply" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessengerAutomation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MessengerAutomation_workspaceId_pageId_isActive_idx" ON "MessengerAutomation"("workspaceId", "pageId", "isActive");
ALTER TABLE "MessengerAutomation" ADD CONSTRAINT "MessengerAutomation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerAutomation" ADD CONSTRAINT "MessengerAutomation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "MessengerPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessengerAutomation" ADD CONSTRAINT "MessengerAutomation_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
