import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { AgentStateService } from "../src/services/agent-state.service";
import { CoachingOutcomeService } from "../src/services/coaching-outcome.service";
import { CoachingStrategyService } from "../src/services/coaching-strategy.service";
import { PrismaService } from "../src/prisma/prisma.service";
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
  : "Set backend/.env DATABASE_URL to run real database Phase 3 strategy tests.";

function createServices() {
  const prisma = new PrismaService();
  const outcomeService = new CoachingOutcomeService(prisma);
  const strategyService = new CoachingStrategyService(prisma);
  const appStore = new AppStoreService(prisma, outcomeService);
  const agentState = new AgentStateService(prisma, appStore, outcomeService, strategyService);

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

async function createUser(appStore: AppStoreService, runId: string) {
  return appStore.createUser(`phase3-strategy-${runId}@example.test`, `password-${runId}`, "Phase3 Strategy");
}

async function createThreadAndRun(agentState: AgentStateService, userId: string) {
  const thread = await agentState.createThread("Phase 3 strategy test", userId);
  const runId = `phase3-strategy-run-${randomUUID()}`;
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

test("phase3 coaching package persists selected strategy template and carries it into outcome", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const user = await createUser(appStore, runId);
    const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, user.id);

    const packageResult = await agentState.createCoachingPackage(
      threadId,
      {
        review: {
          runId: agentRunId,
          type: "weekly_review",
          title: "Recovery-focused review",
          summary: "Recent outcome suggests recovery should be prioritized.",
          adherenceScore: 55,
          riskFlags: ["recent_negative_outcome"],
          focusAreas: ["Reduce intensity"],
          recommendationTags: [],
          inputSnapshot: {},
          resultSnapshot: {}
        },
        proposalGroup: {
          runId: agentRunId,
          title: "Recovery package",
          summary: "Apply a recovery-focused advice snapshot.",
          preview: {},
          riskLevel: "medium"
        },
        proposals: [
          {
            actionType: "create_advice_snapshot",
            entityType: "advice_snapshot",
            title: "Recovery advice",
            summary: "Persist recovery strategy advice.",
            payload: {
              type: "weekly_coaching",
              priority: "high",
              summary: "Prioritize recovery and reduce complexity this week.",
              reasoningTags: ["phase3_strategy"],
              actionItems: ["Lower intensity", "Track fatigue"],
              riskFlags: ["recent_negative_outcome"]
            },
            preview: { strategy: "recovery_priority" },
            riskLevel: "medium"
          }
        ]
      },
      user.id
    );

    assert.equal(typeof packageResult.review.strategy_template_id, "string");
    assert.equal(packageResult.review.strategy_version, "1.0.0");
    assert.equal(packageResult.proposal_group.strategy_template_id, packageResult.review.strategy_template_id);
    assert.deepEqual(packageResult.proposal_group.policy_labels, ["multi_domain_package"]);

    const template = await prisma.coachingStrategyTemplate.findUniqueOrThrow({
      where: { id: packageResult.review.strategy_template_id as string }
    });
    assert.equal(template.key, "recovery_priority");
    assert.equal(template.status, "active");

    const execution = await agentState.confirmProposalGroup(packageResult.proposal_group.id, `strategy-${runId}`, user.id);
    assert.equal(typeof execution.execution.outcomeId, "string");

    const outcome = await prisma.coachingOutcome.findUniqueOrThrow({
      where: { proposalGroupId: packageResult.proposal_group.id }
    });
    assert.equal(outcome.strategyTemplateId, template.id);
    assert.equal(outcome.strategyVersion, "1.0.0");
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
