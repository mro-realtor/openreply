CREATE TABLE "Contact" (
  "id" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "customFields" JSONB NOT NULL DEFAULT '{}',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastInteractionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Contact_instagramAccountId_recipientId_key" ON "Contact"("instagramAccountId", "recipientId");
CREATE INDEX "Contact_instagramAccountId_updatedAt_idx" ON "Contact"("instagramAccountId", "updatedAt");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
