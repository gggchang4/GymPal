-- Phase 4.3: persisted quality gate results for planner/evaluator/reviser.

CREATE TABLE "AgentQualityCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "runId" TEXT,
    "reviewSnapshotId" TEXT,
    "proposalGroupId" TEXT,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "blockedReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "downgradeReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "passedPolicyLabels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentQualityCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentQualityCheck_userId_createdAt_idx" ON "AgentQualityCheck"("userId", "createdAt");
CREATE INDEX "AgentQualityCheck_runId_createdAt_idx" ON "AgentQualityCheck"("runId", "createdAt");
CREATE INDEX "AgentQualityCheck_proposalGroupId_createdAt_idx" ON "AgentQualityCheck"("proposalGroupId", "createdAt");
CREATE INDEX "AgentQualityCheck_reviewSnapshotId_createdAt_idx" ON "AgentQualityCheck"("reviewSnapshotId", "createdAt");
CREATE INDEX "AgentQualityCheck_scope_status_createdAt_idx" ON "AgentQualityCheck"("scope", "status", "createdAt");

ALTER TABLE "AgentQualityCheck"
ADD CONSTRAINT "AgentQualityCheck_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
