-- Phase 3.5: explicit recommendation feedback storage.

CREATE TABLE "RecommendationFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewSnapshotId" TEXT,
    "proposalGroupId" TEXT,
    "feedbackType" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecommendationFeedback_userId_createdAt_idx" ON "RecommendationFeedback"("userId", "createdAt");
CREATE INDEX "RecommendationFeedback_reviewSnapshotId_createdAt_idx" ON "RecommendationFeedback"("reviewSnapshotId", "createdAt");
CREATE INDEX "RecommendationFeedback_proposalGroupId_createdAt_idx" ON "RecommendationFeedback"("proposalGroupId", "createdAt");

ALTER TABLE "RecommendationFeedback"
ADD CONSTRAINT "RecommendationFeedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecommendationFeedback"
ADD CONSTRAINT "RecommendationFeedback_reviewSnapshotId_fkey"
FOREIGN KEY ("reviewSnapshotId") REFERENCES "CoachingReviewSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecommendationFeedback"
ADD CONSTRAINT "RecommendationFeedback_proposalGroupId_fkey"
FOREIGN KEY ("proposalGroupId") REFERENCES "AgentProposalGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
