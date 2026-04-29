-- Phase 3.3: versioned coaching strategy templates and persisted strategy decisions.

ALTER TABLE "CoachingReviewSnapshot"
ADD COLUMN "strategyTemplateId" TEXT,
ADD COLUMN "strategyVersion" TEXT,
ADD COLUMN "evidence" JSONB,
ADD COLUMN "uncertaintyFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "AgentProposalGroup"
ADD COLUMN "strategyTemplateId" TEXT,
ADD COLUMN "strategyVersion" TEXT,
ADD COLUMN "policyLabels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "CoachingStrategyTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "triggerRules" JSONB NOT NULL,
    "riskPolicy" TEXT NOT NULL,
    "outputShape" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingStrategyTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachingStrategyTemplate_key_version_key" ON "CoachingStrategyTemplate"("key", "version");
CREATE INDEX "CoachingStrategyTemplate_status_key_idx" ON "CoachingStrategyTemplate"("status", "key");
