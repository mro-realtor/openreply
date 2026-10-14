-- Additive only. Rollback: see rollback.sql in this folder.
-- Existing campaigns keep their current behaviour: strict follow check off,
-- text-only off, no default assignee.

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "defaultAssigneeUserId" TEXT,
ADD COLUMN     "followGateStrict" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "textOnly" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_defaultAssigneeUserId_fkey" FOREIGN KEY ("defaultAssigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
