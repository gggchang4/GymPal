ALTER TABLE "UserCoachingMemory"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'behavior',
ADD COLUMN "relevanceTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "sourceMessageId" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "conflictGroupId" TEXT,
ADD COLUMN "conflictStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN "lastUsedAt" TIMESTAMP(3),
ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "UserCoachingMemory_userId_category_status_idx"
ON "UserCoachingMemory"("userId", "category", "status");

CREATE INDEX "UserCoachingMemory_userId_conflictStatus_idx"
ON "UserCoachingMemory"("userId", "conflictStatus");

CREATE INDEX "UserCoachingMemory_userId_expiresAt_idx"
ON "UserCoachingMemory"("userId", "expiresAt");
