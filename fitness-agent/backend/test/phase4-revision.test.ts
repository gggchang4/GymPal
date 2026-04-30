import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PrismaService } from "../src/prisma/prisma.service";
import { AgentProductEventService } from "../src/services/agent-product-event.service";
import { AgentQualityService } from "../src/services/agent-quality.service";
import { AgentStateService } from "../src/services/agent-state.service";
import { CoachingOutcomeService } from "../src/services/coaching-outcome.service";
import { CoachingStrategyService } from "../src/services/coaching-strategy.service";
import { AppStoreService } from "../src/store/app-store.service";

function loadBackendEnv() {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= value;
  }
}

loadBackendEnv();

const skipWithoutDatabase = process.env.DATABASE_URL
  ? false
  : "Set backend/.env DATABASE_URL to run real database Phase 4 revision tests.";

function createServices() {
  const prisma = new PrismaService();
  const outcomeService = new CoachingOutcomeService(prisma);
  const strategyService = new CoachingStrategyService(prisma);
  const appStore = new AppStoreService(prisma, outcomeService);
  const productEvents = new AgentProductEventService(prisma);
  const qualityService = new AgentQualityService(prisma, appStore);
  const agentState = new AgentStateService(
    prisma,
    appStore,
    outcomeService,
    strategyService,
    undefined,
    qualityService,
    productEvents
  );

  return { prisma, appStore, agentState };
}

async function cleanupTestUsers(prisma: PrismaService, runId: string) {
  await prisma.user.deleteMany({
    where: {
      email: {
        contains: runId
      }
    }
  });
}

async function createUser(appStore: AppStoreService, runId: string, label: string) {
  return appStore.createUser(`phase4-revision-${label}-${runId}@example.test`, `password-${runId}`, `Phase4 Revision ${label}`);
}

async function createThreadAndRun(agentState: AgentStateService, userId: string) {
  const thread = await agentState.createThread("Phase 4 revision test", userId);
  const runId = `phase4-revision-run-${randomUUID()}`;
  await agentState.createRun(
    thread.id,
    {
      id: runId,
      status: "completed",
      risk_level: "medium",
      steps: []
    },
    userId
  );

  return { threadId: thread.id, runId };
}

async function createAdvicePackage(agentState: AgentStateService, threadId: string, runId: string, userId: string) {
  return agentState.createCoachingPackage(
    threadId,
    {
      review: {
        runId,
        type: "daily_guidance",
        title: "Revision source review",
        summary: "Use a safe package that can be revised before confirmation.",
        adherenceScore: 74,
        focusAreas: ["recovery"],
        recommendationTags: ["daily_guidance"],
        inputSnapshot: { completionRate: 74, sleepHours: 6.5 },
        resultSnapshot: { recommendation: "Keep today's session controlled." },
        evidence: { completionRate: 74, sleepHours: 6.5 }
      },
      proposalGroup: {
        runId,
        title: "Revision source package",
        summary: "Create an advice snapshot after explicit confirmation.",
        preview: { summary: "Controlled daily guidance" },
        riskLevel: "medium"
      },
      proposals: [
        {
          actionType: "create_advice_snapshot",
          entityType: "advice_snapshot",
          title: "Create source advice",
          summary: "Persist the original advice snapshot.",
          payload: {
            type: "daily_guidance",
            priority: "medium",
            summary: "Keep today's session controlled.",
            reasoningTags: ["phase4_revision_source"],
            actionItems: ["Keep RPE moderate."],
            riskFlags: []
          },
          preview: { summary: "Keep today's session controlled." },
          riskLevel: "medium"
        }
      ]
    },
    userId
  );
}

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

test("phase4 revision creates a new pending package and supersedes older executable packages", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const owner = await createUser(appStore, runId, "owner");
    const other = await createUser(appStore, runId, "other");
    const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, owner.id);
    const sourcePackage = await createAdvicePackage(agentState, threadId, agentRunId, owner.id);
    const revisionRequestId = `phase4-revision-${runId}`;

    const revision = await agentState.reviseCoachingReview(
      sourcePackage.review.id,
      {
        sourceProposalGroupId: sourcePackage.proposal_group.id,
        requestId: revisionRequestId,
        revisionReason: "too_hard"
      },
      owner.id
    );

    assert.equal(revision.request_id, revisionRequestId);
    assert.equal(revision.proposal_group.status, "pending");
    assert.equal(revision.proposal_group.risk_level, "low");
    assert.equal(revision.proposals.length, 1);
    assert.equal(revision.quality_check.scope, "package");
    assert.equal(revision.quality_check.proposal_group_id, revision.proposal_group.id);
    assert.deepEqual(revision.superseded_proposal_group_ids, [sourcePackage.proposal_group.id]);

    const oldGroup = await prisma.agentProposalGroup.findUniqueOrThrow({
      where: { id: sourcePackage.proposal_group.id },
      include: { proposals: true }
    });
    assert.equal(oldGroup.status, "superseded");
    assert.ok(oldGroup.proposals.every((proposal) => proposal.status === "superseded"));

    await assert.rejects(
      () => agentState.confirmProposalGroup(sourcePackage.proposal_group.id, `old-confirm-${runId}`, owner.id),
      (error: unknown) => error instanceof Error && error.message.includes("superseded")
    );

    const execution = await agentState.confirmProposalGroup(revision.proposal_group.id, `new-confirm-${runId}`, owner.id);
    assert.equal(execution.proposal_group.status, "executed");
    assert.equal(execution.execution.status, "succeeded");

    const secondRevision = await agentState.reviseCoachingReview(
      sourcePackage.review.id,
      {
        requestId: `${revisionRequestId}-second`,
        revisionReason: "manual"
      },
      owner.id
    );
    assert.equal(secondRevision.proposal_group.status, "pending");
    assert.ok(!secondRevision.superseded_proposal_group_ids.includes(revision.proposal_group.id));

    const thirdRevision = await agentState.reviseCoachingReview(
      sourcePackage.review.id,
      {
        requestId: `${revisionRequestId}-third`,
        revisionReason: "manual"
      },
      owner.id
    );
    assert.equal(thirdRevision.proposal_group.status, "pending");
    assert.ok(thirdRevision.superseded_proposal_group_ids.includes(secondRevision.proposal_group.id));

    await assert.rejects(
      () => agentState.confirmProposalGroup(secondRevision.proposal_group.id, `second-confirm-${runId}`, owner.id),
      (error: unknown) => error instanceof Error && error.message.includes("superseded")
    );

    const concurrentRevisions = await Promise.all([
      agentState.reviseCoachingReview(
        sourcePackage.review.id,
        {
          requestId: `${revisionRequestId}-concurrent-a`,
          revisionReason: "manual"
        },
        owner.id
      ),
      agentState.reviseCoachingReview(
        sourcePackage.review.id,
        {
          requestId: `${revisionRequestId}-concurrent-b`,
          revisionReason: "manual"
        },
        owner.id
      )
    ]);
    assert.equal(concurrentRevisions.length, 2);

    const pendingCandidates = await prisma.agentProposalGroup.findMany({
      where: {
        userId: owner.id,
        threadId,
        status: "pending"
      },
      include: { reviewSnapshot: true }
    });
    const pendingRevisionGroups = pendingCandidates.filter((group) => {
      const inputSnapshot = jsonObject(group.reviewSnapshot?.inputSnapshot);

      return group.reviewSnapshotId === sourcePackage.review.id || inputSnapshot.sourceReviewId === sourcePackage.review.id;
    });
    assert.equal(pendingRevisionGroups.length, 1);
    assert.ok(concurrentRevisions.some((item) => item.proposal_group.id === pendingRevisionGroups[0].id));

    await assert.rejects(
      () => agentState.reviseCoachingReview(sourcePackage.review.id, {}, other.id),
      (error: unknown) => error instanceof Error && error.message.includes("Coaching review snapshot not found")
    );

    const revisionEvent = await prisma.agentProductEvent.findFirst({
      where: { userId: owner.id, eventType: "revision_requested", requestId: revisionRequestId }
    });
    assert.ok(revisionEvent);
    assert.equal(revisionEvent.entityId, revision.proposal_group.id);
    assert.equal((revisionEvent.payload as Record<string, unknown>).sourceReviewId, sourcePackage.review.id);
    assert.equal((revisionEvent.payload as Record<string, unknown>).sourceProposalGroupId, sourcePackage.proposal_group.id);
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
