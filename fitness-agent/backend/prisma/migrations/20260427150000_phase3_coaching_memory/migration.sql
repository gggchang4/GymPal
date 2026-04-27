CREATE TABLE "UserCoachingMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 60,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCoachingMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoachingMemoryEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryId" TEXT,
    "eventType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachingMemoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserCoachingMemory_userId_status_updatedAt_idx" ON "UserCoachingMemory"("userId", "status", "updatedAt");
CREATE INDEX "UserCoachingMemory_userId_memoryType_status_idx" ON "UserCoachingMemory"("userId", "memoryType", "status");
CREATE INDEX "CoachingMemoryEvent_userId_createdAt_idx" ON "CoachingMemoryEvent"("userId", "createdAt");
CREATE INDEX "CoachingMemoryEvent_memoryId_createdAt_idx" ON "CoachingMemoryEvent"("memoryId", "createdAt");

ALTER TABLE "UserCoachingMemory"
ADD CONSTRAINT "UserCoachingMemory_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachingMemoryEvent"
ADD CONSTRAINT "CoachingMemoryEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachingMemoryEvent"
ADD CONSTRAINT "CoachingMemoryEvent_memoryId_fkey"
FOREIGN KEY ("memoryId") REFERENCES "UserCoachingMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
