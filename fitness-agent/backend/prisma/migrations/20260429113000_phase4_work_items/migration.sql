-- Phase 4.1: product work items and product event trace.

CREATE TABLE "AgentWorkItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requestId" TEXT,
    "relatedThreadId" TEXT,
    "relatedReviewId" TEXT,
    "relatedProposalGroupId" TEXT,
    "relatedOutcomeId" TEXT,
    "convertedEntityType" TEXT,
    "convertedEntityId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentWorkItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentProductEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "requestId" TEXT,
    "sessionId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentProductEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentWorkItem_userId_status_priority_createdAt_idx"
ON "AgentWorkItem"("userId", "status", "priority", "createdAt");

CREATE INDEX "AgentWorkItem_userId_type_status_createdAt_idx"
ON "AgentWorkItem"("userId", "type", "status", "createdAt");

CREATE INDEX "AgentWorkItem_requestId_idx" ON "AgentWorkItem"("requestId");
CREATE INDEX "AgentWorkItem_relatedProposalGroupId_idx" ON "AgentWorkItem"("relatedProposalGroupId");
CREATE INDEX "AgentWorkItem_relatedOutcomeId_idx" ON "AgentWorkItem"("relatedOutcomeId");

CREATE UNIQUE INDEX "AgentWorkItem_active_dedupe_idx"
ON "AgentWorkItem"(
  "userId",
  "type",
  COALESCE("relatedThreadId", ''),
  COALESCE("relatedReviewId", ''),
  COALESCE("relatedProposalGroupId", ''),
  COALESCE("relatedOutcomeId", '')
)
WHERE "status" IN ('pending', 'opened');

CREATE INDEX "AgentProductEvent_userId_createdAt_idx" ON "AgentProductEvent"("userId", "createdAt");
CREATE INDEX "AgentProductEvent_eventType_createdAt_idx" ON "AgentProductEvent"("eventType", "createdAt");
CREATE INDEX "AgentProductEvent_requestId_idx" ON "AgentProductEvent"("requestId");
CREATE INDEX "AgentProductEvent_entityType_entityId_idx" ON "AgentProductEvent"("entityType", "entityId");

ALTER TABLE "AgentWorkItem"
ADD CONSTRAINT "AgentWorkItem_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentProductEvent"
ADD CONSTRAINT "AgentProductEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
