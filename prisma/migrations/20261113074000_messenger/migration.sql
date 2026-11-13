-- CreateTable
CREATE TABLE "MessengerPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,

    CONSTRAINT "MessengerPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerEvent" (
    "pageId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,

    CONSTRAINT "MessengerEvent_pkey" PRIMARY KEY ("pageId","eventId")
);

-- CreateIndex
CREATE INDEX "MessengerPage_workspaceId_idx" ON "MessengerPage"("workspaceId");

-- CreateIndex
CREATE INDEX "MessengerEvent_pageId_recipientId_receivedAt_idx" ON "MessengerEvent"("pageId", "recipientId", "receivedAt");

-- AddForeignKey
ALTER TABLE "MessengerPage" ADD CONSTRAINT "MessengerPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerEvent" ADD CONSTRAINT "MessengerEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "MessengerPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

