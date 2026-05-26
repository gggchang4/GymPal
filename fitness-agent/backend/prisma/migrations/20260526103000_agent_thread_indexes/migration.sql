CREATE INDEX "AgentThread_userId_updatedAt_idx" ON "AgentThread"("userId", "updatedAt");

CREATE INDEX "AgentMessage_threadId_createdAt_idx" ON "AgentMessage"("threadId", "createdAt");
