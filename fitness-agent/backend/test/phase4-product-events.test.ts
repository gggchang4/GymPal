import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { AuthTokenClaims } from "../src/auth/auth-token.service";
import { AgentFeedbackController } from "../src/controllers/agent-feedback.controller";
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
  : "Set backend/.env DATABASE_URL to run real database Phase 4 product event tests.";

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
  const feedbackController = new AgentFeedbackController(appStore, prisma, productEvents);

  return { prisma, appStore, agentState, feedbackController };
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
  return appStore.createUser(`phase4-product-events-${runId}@example.test`, `password-${runId}`, "Phase4 Product Events");
}

async function createThreadAndRun(agentState: AgentStateService, userId: string) {
  const thread = await agentState.createThread("Phase 4 product event test", userId);
  const runId = `phase4-product-events-run-${randomUUID()}`;
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

async function createAdvicePackage(agentState: AgentStateService, threadId: string, runId: string, userId: string, label: string) {
  return agentState.createCoachingPackage(
    threadId,
    {
      review: {
        runId,
        type: "daily_guidance",
        title: `${label} review`,
        summary: "Use a low-risk advice package to verify product event logging.",
        adherenceScore: 75,
        focusAreas: ["recovery"],
        recommendationTags: ["daily_guidance"],
        inputSnapshot: { completionRate: 75 },
        resultSnapshot: { recommendation: "Keep today's work controlled." },
        evidence: { completionRate: 75 }
      },
      proposalGroup: {
        runId,
        title: `${label} package`,
        summary: "Create one advice snapshot after explicit confirmation.",
        preview: { summary: "Controlled daily guidance" },
        riskLevel: "medium"
      },
      proposals: [
        {
          actionType: "create_advice_snapshot",
          entityType: "advice_snapshot",
          title: `${label} advice`,
          summary: "Persist a safe advice snapshot.",
          payload: {
            type: "daily_guidance",
            priority: "medium",
            summary: "Keep today's work controlled.",
            reasoningTags: ["phase4_product_events"],
            actionItems: ["Keep RPE moderate."],
            riskFlags: []
          },
          preview: { summary: "Keep today's work controlled." },
          riskLevel: "medium"
        }
      ]
    },
    userId
  );
}

test("phase4 records package and feedback product events", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState, feedbackController } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const user = await createUser(appStore, runId);
    const authUser: AuthTokenClaims = {
      sub: user.id,
      email: user.email,
      name: user.name,
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 3600
    };
    const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, user.id);

    const approvedPackage = await createAdvicePackage(agentState, threadId, agentRunId, user.id, "Approved");
    const approvalKey = `phase4-product-event-approve-${runId}`;
    await agentState.confirmProposalGroup(approvedPackage.proposal_group.id, approvalKey, user.id);

    const rejectedPackage = await createAdvicePackage(agentState, threadId, agentRunId, user.id, "Rejected");
    await agentState.rejectProposalGroup(rejectedPackage.proposal_group.id, user.id);

    const feedback = await feedbackController.createRecommendationFeedback(
      {
        proposalGroupId: approvedPackage.proposal_group.id,
        feedbackType: "helpful"
      },
      authUser
    );
    assert.equal(feedback.feedbackType, "helpful");

    const events = await prisma.agentProductEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" }
    });

    const approvedEvent = events.find((event) => event.eventType === "package_approved");
    assert.ok(approvedEvent);
    assert.equal(approvedEvent.entityId, approvedPackage.proposal_group.id);
    assert.equal(approvedEvent.requestId, approvalKey);

    const rejectedEvent = events.find((event) => event.eventType === "package_rejected");
    assert.ok(rejectedEvent);
    assert.equal(rejectedEvent.entityId, rejectedPackage.proposal_group.id);

    const feedbackEvent = events.find((event) => event.eventType === "feedback_submitted");
    assert.ok(feedbackEvent);
    assert.equal(feedbackEvent.entityId, feedback.id);
    assert.equal((feedbackEvent.payload as Record<string, unknown>).hasNote, false);
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
