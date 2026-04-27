-- Phase 3.2: outcome evaluation skeleton.
-- Outcomes are created only after a coaching package is successfully executed.
CREATE TABLE "CoachingOutcome" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reviewSnapshotId" TEXT,
  "proposalGroupId" TEXT,
  "strategyTemplateId" TEXT,
  "strategyVersion" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "measurementStart" TIMESTAMP(3) NOT NULL,
  "measurementEnd" TIMESTAMP(3) NOT NULL,
  "baseline" JSONB NOT NULL,
  "observed" JSONB NOT NULL,
  "score" INTEGER,
  "signals" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoachingOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachingOutcome_proposalGroupId_key" ON "CoachingOutcome"("proposalGroupId");
CREATE INDEX "CoachingOutcome_userId_status_updatedAt_idx" ON "CoachingOutcome"("userId", "status", "updatedAt");
CREATE INDEX "CoachingOutcome_reviewSnapshotId_createdAt_idx" ON "CoachingOutcome"("reviewSnapshotId", "createdAt");

ALTER TABLE "CoachingOutcome"
ADD CONSTRAINT "CoachingOutcome_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachingOutcome"
ADD CONSTRAINT "CoachingOutcome_reviewSnapshotId_fkey"
FOREIGN KEY ("reviewSnapshotId") REFERENCES "CoachingReviewSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CoachingOutcome"
ADD CONSTRAINT "CoachingOutcome_proposalGroupId_fkey"
FOREIGN KEY ("proposalGroupId") REFERENCES "AgentProposalGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
