import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { AppStoreService } from "../src/store/app-store.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AgentStateService } from "../src/services/agent-state.service";
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

const databaseUrl = process.env.DATABASE_URL;
const skipWithoutDatabase = databaseUrl ? false : "Set backend/.env DATABASE_URL to run real database Phase 2 e2e tests.";

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

async function createUser(appStore: AppStoreService, runId: string, label: string) {
  return appStore.createUser(`phase2-${label}-${runId}@example.test`, `password-${runId}`, `Phase2 ${label}`);
}

async function createThreadAndRun(agentState: AgentStateService, userId: string) {
  const thread = await agentState.createThread("Phase 2 e2e", userId);
  const runId = `phase2-run-${randomUUID()}`;
  await agentState.createRun(
    thread.id,
    {
      id: runId,
      status: "completed",
      risk_level: "high",
      steps: []
    },
    userId
  );

  return { threadId: thread.id, runId };
}

test(
  "phase2 coaching package rolls back business writes when one grouped action fails",
  { skip: skipWithoutDatabase },
  async () => {
    const runId = randomUUID();
    const { prisma, appStore, agentState } = createServices();
    await prisma.$connect();

    try {
      await cleanupTestUsers(prisma, runId);
      const user = await createUser(appStore, runId, "rollback");
      const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, user.id);
      const originalPlan = await prisma.workoutPlan.create({
        data: {
          userId: user.id,
          title: "Original active plan",
          goal: "maintenance",
          weekOf: new Date("2099-04-20T00:00:00.000Z"),
          status: "active",
          version: 1,
          days: {
            create: [
              {
                dayLabel: "Monday",
                focus: "Original strength day",
                duration: "45 min",
                exercises: ["Squat 3x5"],
                recoveryTip: "Keep it easy.",
                sortOrder: 0
              }
            ]
          }
        }
      });

      const packageResult = await agentState.createCoachingPackage(
        threadId,
        {
          review: {
            runId: agentRunId,
            type: "weekly_review",
            title: "Rollback review",
            summary: "This package intentionally fails after the first business write."
          },
          proposalGroup: {
            runId: agentRunId,
            title: "Rollback package",
            summary: "Generate a new plan, then hit an unsupported transactional action.",
            preview: { intent: "rollback" },
            riskLevel: "high"
          },
          proposals: [
            {
              actionType: "generate_next_week_plan",
              entityType: "workout_plan",
              title: "Generate next week plan",
              summary: "This write should be rolled back.",
              payload: {
                title: "Should not persist",
                goal: "maintenance",
                weekOf: "2099-04-27",
                days: [
                  {
                    dayLabel: "Tuesday",
                    focus: "Should not persist",
                    duration: "40 min",
                    exercises: ["Row 3x10"],
                    recoveryTip: "Rollback expected."
                  }
                ]
              },
              preview: { title: "Should not persist" },
              riskLevel: "high",
              basePlanId: originalPlan.id,
              basePlanVersion: originalPlan.version,
              basePlanUpdatedAt: originalPlan.updatedAt.toISOString()
            },
            {
              actionType: "adjust_plan",
              entityType: "workout_plan",
              title: "Unsupported package action",
              summary: "This action is intentionally blocked inside a transactional package.",
              payload: { note: "force rollback" },
              preview: { note: "force rollback" },
              riskLevel: "high"
            }
          ]
        },
        user.id
      );

      await assert.rejects(
        () => agentState.executeProposalGroup(packageResult.proposal_group.id, `idem-${runId}`, user.id),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("not supported inside a transactional coaching package")
      );

      const plans = await prisma.workoutPlan.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" }
      });
      assert.equal(plans.length, 1);
      assert.equal(plans[0].id, originalPlan.id);
      assert.equal(plans[0].status, "active");

      const executions = await prisma.agentActionExecution.findMany({
        where: { proposal: { proposalGroupId: packageResult.proposal_group.id } }
      });
      assert.equal(executions.length, 0);

      const group = await prisma.agentProposalGroup.findUniqueOrThrow({
        where: { id: packageResult.proposal_group.id }
      });
      assert.equal(group.status, "failed");

      const review = await prisma.coachingReviewSnapshot.findUniqueOrThrow({
        where: { id: packageResult.review.id }
      });
      assert.equal(review.status, "failed");

      const proposalStatuses = await prisma.agentActionProposal.findMany({
        where: { proposalGroupId: packageResult.proposal_group.id },
        select: { status: true }
      });
      assert.deepEqual(
        proposalStatuses.map((proposal) => proposal.status).sort(),
        ["failed", "failed"]
      );
    } finally {
      await cleanupTestUsers(prisma, runId);
      await prisma.$disconnect();
    }
  }
);

test("phase2 review and package state is isolated between users", { skip: skipWithoutDatabase }, async () => {
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
          title: "Owner-only review",
          summary: "This review belongs to one user only."
        },
        proposalGroup: {
          runId: agentRunId,
          title: "Owner-only package",
          summary: "Another user must not see or confirm this.",
          preview: { scope: "owner" },
          riskLevel: "medium"
        },
        proposals: [
          {
            actionType: "create_advice_snapshot",
            entityType: "advice_snapshot",
            title: "Create owner advice",
            summary: "Persist owner-only advice.",
            payload: {
              type: "daily_guidance",
              priority: "medium",
              summary: "Owner-only advice",
              reasoningTags: ["phase2"],
              actionItems: ["Keep the account boundary intact."],
              riskFlags: []
            },
            preview: { summary: "Owner-only advice" },
            riskLevel: "medium"
          }
        ]
      },
      owner.id
    );

    await assert.rejects(
      () => agentState.getProposalGroup(packageResult.proposal_group.id, other.id),
      (error: unknown) => error instanceof NotFoundException
    );
    await assert.rejects(
      () => agentState.confirmProposalGroup(packageResult.proposal_group.id, `cross-${runId}`, other.id),
      (error: unknown) => error instanceof NotFoundException
    );

    const otherSummary = await appStore.getCoachSummary(other.id);
    assert.equal(otherSummary.pendingCoachingPackage, null);

    const ownerGroup = await agentState.getProposalGroup(packageResult.proposal_group.id, owner.id);
    assert.equal(ownerGroup.id, packageResult.proposal_group.id);
    assert.equal(ownerGroup.status, "pending");
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
