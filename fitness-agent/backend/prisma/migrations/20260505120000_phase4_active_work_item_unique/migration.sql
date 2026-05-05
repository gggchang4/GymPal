-- Phase 4 hardening: prevent duplicate active work items for the same user/type/related target.
CREATE UNIQUE INDEX IF NOT EXISTS "AgentWorkItem_active_dedupe_idx"
ON "AgentWorkItem" (
  "userId",
  "type",
  COALESCE("relatedThreadId", ''),
  COALESCE("relatedReviewId", ''),
  COALESCE("relatedProposalGroupId", ''),
  COALESCE("relatedOutcomeId", '')
)
WHERE "status" IN ('pending', 'opened');
