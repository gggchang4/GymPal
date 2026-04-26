-- Phase 2 coaching reviews and proposal groups

CREATE TABLE "CoachingReviewSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "runId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "adherenceScore" INTEGER,
    "riskFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "focusAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendationTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputSnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingReviewSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentProposalGroup" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewSnapshotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProposalGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AgentActionProposal"
ADD COLUMN     "proposalGroupId" TEXT;

CREATE INDEX "CoachingReviewSnapshot_userId_type_createdAt_idx" ON "CoachingReviewSnapshot"("userId", "type", "createdAt");
CREATE INDEX "CoachingReviewSnapshot_threadId_createdAt_idx" ON "CoachingReviewSnapshot"("threadId", "createdAt");
CREATE INDEX "AgentProposalGroup_threadId_status_createdAt_idx" ON "AgentProposalGroup"("threadId", "status", "createdAt");
CREATE INDEX "AgentProposalGroup_userId_status_createdAt_idx" ON "AgentProposalGroup"("userId", "status", "createdAt");
CREATE INDEX "AgentProposalGroup_reviewSnapshotId_createdAt_idx" ON "AgentProposalGroup"("reviewSnapshotId", "createdAt");
CREATE INDEX "AgentActionProposal_proposalGroupId_createdAt_idx" ON "AgentActionProposal"("proposalGroupId", "createdAt");

ALTER TABLE "CoachingReviewSnapshot"
ADD CONSTRAINT "CoachingReviewSnapshot_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachingReviewSnapshot"
ADD CONSTRAINT "CoachingReviewSnapshot_threadId_fkey"
FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachingReviewSnapshot"
ADD CONSTRAINT "CoachingReviewSnapshot_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentProposalGroup"
ADD CONSTRAINT "AgentProposalGroup_threadId_fkey"
FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentProposalGroup"
ADD CONSTRAINT "AgentProposalGroup_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentProposalGroup"
ADD CONSTRAINT "AgentProposalGroup_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentProposalGroup"
ADD CONSTRAINT "AgentProposalGroup_reviewSnapshotId_fkey"
FOREIGN KEY ("reviewSnapshotId") REFERENCES "CoachingReviewSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentActionProposal"
ADD CONSTRAINT "AgentActionProposal_proposalGroupId_fkey"
FOREIGN KEY ("proposalGroupId") REFERENCES "AgentProposalGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
