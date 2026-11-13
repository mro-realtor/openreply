-- CreateTable
CREATE TABLE "InboxThreadState" (
    "workspaceId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "readThrough" TEXT,
    "assigneeId" TEXT,

    CONSTRAINT "InboxThreadState_pkey" PRIMARY KEY ("workspaceId","threadKey")
);

-- CreateTable
CREATE TABLE "InboxThreadNote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxThreadNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxThreadNote_workspaceId_threadKey_createdAt_idx" ON "InboxThreadNote"("workspaceId", "threadKey", "createdAt");

-- AddForeignKey
ALTER TABLE "InboxThreadState" ADD CONSTRAINT "InboxThreadState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThreadNote" ADD CONSTRAINT "InboxThreadNote_workspaceId_threadKey_fkey" FOREIGN KEY ("workspaceId", "threadKey") REFERENCES "InboxThreadState"("workspaceId", "threadKey") ON DELETE CASCADE ON UPDATE CASCADE;

