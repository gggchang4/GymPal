import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { AppStoreService } from "../src/store/app-store.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AgentStateService } from "../src/services/agent-state.service";
import { AgentWorkItemService } from "../src/services/agent-work-item.service";
import { AgentQualityService } from "../src/services/agent-quality.service";
import { CoachingOutcomeService } from "../src/services/coaching-outcome.service";
import { CoachingStrategyService } from "../src/services/coaching-strategy.service";

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
  : "Set backend/.env DATABASE_URL to run real database Phase 4 quality tests.";

function createServices() {
  const prisma = new PrismaService();
  const outcomeService = new CoachingOutcomeService(prisma);
  const strategyService = new CoachingStrategyService(prisma);
  const appStore = new AppStoreService(prisma, outcomeService);
  const qualityService = new AgentQualityService(prisma, appStore);
  const agentState = new AgentStateService(prisma, appStore, outcomeService, strategyService, undefined, qualityService);
  const workItems = new AgentWorkItemService(prisma, appStore);

  return { prisma, appStore, agentState, qualityService, workItems };
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
  return appStore.createUser(`phase4-quality-${label}-${runId}@example.test`, `password-${runId}`, `Phase4 Quality ${label}`);
}

async function createThreadAndRun(agentState: AgentStateService, userId: string) {
  const thread = await agentState.createThread("Phase 4 quality test", userId);
  const runId = `phase4-quality-run-${randomUUID()}`;
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

test("phase4 quality checks are persisted for reviews and coaching packages", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState, qualityService, workItems } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const owner = await createUser(appStore, runId, "owner");
    const other = await createUser(appStore, runId, "other");
    const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, owner.id);

    const reviewResult = await agentState.createCoachingReview(
      threadId,
      {
        runId: agentRunId,
        type: "weekly_review",
        title: "Quality seed review",
        summary: "A review with enough structured evidence for a passed quality check.",
        adherenceScore: 82,
        focusAreas: ["consistency"],
        recommendationTags: ["weekly_review"],
        inputSnapshot: { completionRate: 82, recentWorkoutLogs: 3 },
        resultSnapshot: { recommendation: "Keep progression conservative." },
        evidence: { completionRate: 82 }
      },
      owner.id
    );

    assert.equal(reviewResult.quality_check.scope, "review");
    assert.equal(reviewResult.quality_check.status, "passed");
    assert.equal(reviewResult.quality_check.review_snapshot_id, reviewResult.id);

    const packageResult = await agentState.createCoachingPackage(
      threadId,
      {
        review: {
          runId: agentRunId,
          type: "daily_guidance",
          title: "Package quality review",
          summary: "Create a low-risk package with evidence.",
          adherenceScore: 76,
          focusAreas: ["recovery"],
          recommendationTags: ["daily_guidance"],
          inputSnapshot: { sleepHours: 7.5, completionRate: 76 },
          resultSnapshot: { recommendation: "Persist a recovery-focused advice item." },
          evidence: { sleepHours: 7.5 }
        },
        proposalGroup: {
          runId: agentRunId,
          title: "Quality package",
          summary: "Persist one advice snapshot after confirmation.",
          preview: { scope: "advice", summary: "Recovery-focused advice" },
          riskLevel: "medium"
        },
        proposals: [
          {
            actionType: "create_advice_snapshot",
            entityType: "advice_snapshot",
            title: "Create quality advice",
            summary: "Persist advice for quality test.",
            payload: {
              type: "daily_guidance",
              priority: "medium",
              summary: "Keep today's session controlled.",
              reasoningTags: ["phase4_quality"],
              actionItems: ["Keep RPE moderate."],
              riskFlags: []
            },
            preview: { summary: "Keep today's session controlled." },
            riskLevel: "medium"
          }
        ]
      },
      owner.id
    );

    assert.equal(packageResult.quality_check.scope, "package");
    assert.equal(packageResult.quality_check.status, "passed");
    assert.equal(packageResult.quality_check.proposal_group_id, packageResult.proposal_group.id);

    const packageChecks = await qualityService.listForProposalGroup(packageResult.proposal_group.id, owner.id);
    assert.equal(packageChecks.length, 1);
    assert.equal(packageChecks[0].id, packageResult.quality_check.id);

    await assert.rejects(
      () => qualityService.listForProposalGroup(packageResult.proposal_group.id, other.id),
      (error: unknown) => error instanceof Error && error.message.includes("Agent proposal group not found")
    );

    const runChecks = await qualityService.listForRun(agentRunId, owner.id);
    assert.ok(runChecks.length >= 2);
    assert.ok(runChecks.every((check) => check.run_id === agentRunId));

    const workspace = await workItems.buildWorkspaceSummary(owner.id);
    assert.ok(workspace.latestQualityChecks.length >= 1);
    assert.ok(workspace.latestQualityChecks.some((check) => check.id === packageResult.quality_check.id));

    const downgradedReview = await agentState.createCoachingReview(
      threadId,
      {
        runId: agentRunId,
        type: "daily_guidance",
        title: "Thin review",
        summary: "Not enough structured data yet.",
        focusAreas: [],
        recommendationTags: [],
        inputSnapshot: {},
        resultSnapshot: {}
      },
      owner.id
    );
    assert.equal(downgradedReview.quality_check.status, "downgraded");
    assert.ok(downgradedReview.quality_check.downgrade_reasons.includes("missing_adherence_score"));
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
