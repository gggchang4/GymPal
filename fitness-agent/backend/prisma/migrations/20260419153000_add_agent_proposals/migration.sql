ALTER TABLE "AgentMessage"
ADD COLUMN "cards" JSONB;

CREATE TABLE "AgentActionProposal" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "actionType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentActionProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentActionExecution" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestPayload" JSONB NOT NULL,
  "resultPayload" JSONB,
  "errorMessage" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentActionExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentActionProposal_threadId_status_createdAt_idx" ON "AgentActionProposal"("threadId", "status", "createdAt");
CREATE INDEX "AgentActionProposal_runId_createdAt_idx" ON "AgentActionProposal"("runId", "createdAt");
CREATE INDEX "AgentActionProposal_userId_status_createdAt_idx" ON "AgentActionProposal"("userId", "status", "createdAt");
CREATE INDEX "AgentActionExecution_userId_createdAt_idx" ON "AgentActionExecution"("userId", "createdAt");
CREATE UNIQUE INDEX "AgentActionExecution_proposalId_idempotencyKey_key" ON "AgentActionExecution"("proposalId", "idempotencyKey");

ALTER TABLE "AgentActionProposal"
ADD CONSTRAINT "AgentActionProposal_threadId_fkey"
FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentActionProposal"
ADD CONSTRAINT "AgentActionProposal_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "AgentRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentActionProposal"
ADD CONSTRAINT "AgentActionProposal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentActionExecution"
ADD CONSTRAINT "AgentActionExecution_proposalId_fkey"
FOREIGN KEY ("proposalId") REFERENCES "AgentActionProposal"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentActionExecution"
ADD CONSTRAINT "AgentActionExecution_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
