import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { AppStoreService } from "../src/store/app-store.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AgentStateService } from "../src/services/agent-state.service";

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
  : "Set backend/.env DATABASE_URL to run real database Phase 3 outcome tests.";

function createServices() {
  const prisma = new PrismaService();
  const appStore = new AppStoreService(prisma);
  const agentState = new AgentStateService(prisma, appStore);

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
  return appStore.createUser(`phase3-outcome-${label}-${runId}@example.test`, `password-${runId}`, `Phase3 Outcome ${label}`);
}

async function createThreadAndRun(agentState: AgentStateService, userId: string) {
  const thread = await agentState.createThread("Phase 3 outcome test", userId);
  const runId = `phase3-outcome-run-${randomUUID()}`;
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

test("phase3 coaching package execution creates one pending outcome and exposes it in coach summary", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const owner = await createUser(appStore, runId, "owner");
    const other = await createUser(appStore, runId, "other");
    const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, owner.id);

    const packageResult = await agentState.createCoachingPackage(
      threadId,
      {
        review: {
          runId: agentRunId,
          type: "daily_guidance",
          title: "Outcome seed review",
          summary: "Create a package that should start outcome measurement.",
          adherenceScore: 68,
          focusAreas: ["recovery"],
          recommendationTags: ["daily_guidance"],
          inputSnapshot: { completionRate: 68 },
          resultSnapshot: { recommendation: "Keep the session easy." }
        },
        proposalGroup: {
          runId: agentRunId,
          title: "Outcome seed package",
          summary: "Persist advice and create an outcome after execution.",
          preview: { scope: "outcome" },
          riskLevel: "medium"
        },
        proposals: [
          {
            actionType: "create_advice_snapshot",
            entityType: "advice_snapshot",
            title: "Create outcome advice",
            summary: "Persist advice for outcome test.",
            payload: {
              type: "daily_guidance",
              priority: "medium",
              summary: "Keep the session easy.",
              reasoningTags: ["phase3_outcome"],
              actionItems: ["Keep RPE moderate."],
              riskFlags: []
            },
            preview: { summary: "Keep the session easy." },
            riskLevel: "medium"
          }
        ]
      },
      owner.id
    );

    const idempotencyKey = `outcome-${runId}`;
    const firstExecution = await agentState.confirmProposalGroup(packageResult.proposal_group.id, idempotencyKey, owner.id);
    assert.equal(firstExecution.execution.status, "succeeded");
    assert.equal(typeof firstExecution.execution.outcomeId, "string");

    const secondExecution = await agentState.confirmProposalGroup(packageResult.proposal_group.id, idempotencyKey, owner.id);
    assert.equal(secondExecution.execution.outcomeId, firstExecution.execution.outcomeId);

    const outcomes = await prisma.coachingOutcome.findMany({
      where: { proposalGroupId: packageResult.proposal_group.id }
    });
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].status, "pending");
    assert.equal(outcomes[0].userId, owner.id);
    assert.equal(outcomes[0].reviewSnapshotId, packageResult.review.id);
    assert.ok(outcomes[0].measurementEnd.getTime() > outcomes[0].measurementStart.getTime());
    assert.equal(
      outcomes[0].measurementEnd.getTime() - outcomes[0].measurementStart.getTime(),
      7 * 24 * 60 * 60 * 1000
    );

    const baseline = outcomes[0].baseline as Record<string, unknown>;
    const signals = outcomes[0].signals as Record<string, unknown>;
    assert.equal(baseline.reviewType, "daily_guidance");
    assert.equal(baseline.reviewTitle, "Outcome seed review");
    assert.equal(signals.source, "coaching_package_execution");
    assert.equal(signals.actionCount, 1);

    const ownerSummary = await appStore.getCoachSummary(owner.id);
    assert.equal(ownerSummary.recentOutcomes.length, 1);
    assert.equal(ownerSummary.recentOutcomes[0].id, outcomes[0].id);
    assert.equal(ownerSummary.recentOutcomes[0].proposalGroupId, packageResult.proposal_group.id);

    const otherSummary = await appStore.getCoachSummary(other.id);
    assert.equal(otherSummary.recentOutcomes.length, 0);
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
