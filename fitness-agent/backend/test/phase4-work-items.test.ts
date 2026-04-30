import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { AppStoreService } from "../src/store/app-store.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AgentProductEventService } from "../src/services/agent-product-event.service";
import { AgentQualityService } from "../src/services/agent-quality.service";
import { AgentStateService } from "../src/services/agent-state.service";
import { AgentWorkItemService } from "../src/services/agent-work-item.service";
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
  : "Set backend/.env DATABASE_URL to run real database Phase 4 work item tests.";

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
  const workItems = new AgentWorkItemService(prisma, appStore, productEvents, agentState);

  return { prisma, appStore, agentState, workItems };
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
  return appStore.createUser(`phase4-work-items-${label}-${runId}@example.test`, `password-${runId}`, `Phase4 ${label}`);
}

test("phase4 work item refresh dedupes active items and records product events", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, workItems } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const owner = await createUser(appStore, runId, "owner");
    const other = await createUser(appStore, runId, "other");

    const firstRefresh = await workItems.refreshWorkItems(owner.id, {
      requestId: `phase4-refresh-${runId}`,
      source: "dashboard_refresh"
    });
    assert.ok(firstRefresh.created.length >= 1);
    assert.ok(firstRefresh.pending.some((item) => item.type === "weekly_review_due"));
    assert.ok(firstRefresh.pending.some((item) => item.type === "log_gap"));

    const secondRefresh = await workItems.refreshWorkItems(owner.id, {
      requestId: `phase4-refresh-repeat-${runId}`,
      source: "dashboard_refresh"
    });
    assert.equal(secondRefresh.created.length, 0);
    assert.ok(secondRefresh.updated.length >= 1);

    const activeRows = await prisma.agentWorkItem.findMany({
      where: { userId: owner.id, status: { in: ["pending", "opened"] } }
    });
    const uniqueKeys = new Set(activeRows.map((item) => `${item.type}:${item.relatedProposalGroupId ?? ""}:${item.relatedOutcomeId ?? ""}`));
    assert.equal(uniqueKeys.size, activeRows.length);

    const target = firstRefresh.pending[0];
    await assert.rejects(
      () => workItems.openWorkItem(target.id, other.id),
      (error: unknown) => error instanceof Error && error.message.includes("Agent work item not found")
    );

    const opened = await workItems.openWorkItem(target.id, owner.id);
    assert.equal(opened.workItem.status, "opened");
    assert.equal(typeof opened.navigation.route, "string");

    const dismissed = await workItems.dismissWorkItem(target.id, owner.id, {
      reason: "test_dismiss",
      requestId: `phase4-dismiss-${runId}`
    });
    assert.equal(dismissed.status, "dismissed");

    const afterDismissRefresh = await workItems.refreshWorkItems(owner.id, {
      requestId: `phase4-after-dismiss-${runId}`,
      source: "dashboard_refresh"
    });
    assert.ok(afterDismissRefresh.skipped.some((item) => item.type === target.type && item.reason === "recently_dismissed"));
    assert.ok(!afterDismissRefresh.pending.some((item) => item.id === target.id));

    const ownerEvents = await prisma.agentProductEvent.findMany({
      where: { userId: owner.id },
      orderBy: { createdAt: "asc" }
    });
    assert.ok(ownerEvents.some((event) => event.eventType === "work_item_created"));
    assert.ok(ownerEvents.some((event) => event.eventType === "work_item_opened"));
    assert.ok(ownerEvents.some((event) => event.eventType === "work_item_dismissed"));

    const otherItems = await workItems.listWorkItems(other.id);
    assert.equal(otherItems.length, 0);

    const workspace = await workItems.buildWorkspaceSummary(owner.id);
    assert.equal(workspace.coachSummary.memorySummary.activeMemories.length, 0);
    assert.ok(Array.isArray(workspace.pendingWorkItems));
    assert.ok(Array.isArray(workspace.recommendedEntryPoints));
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});

test("phase4 revision work item converts into one latest pending revision package", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState, workItems } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const owner = await createUser(appStore, runId, "convert-owner");
    const other = await createUser(appStore, runId, "convert-other");
    const thread = await agentState.createThread("Phase 4 work item conversion", owner.id);
    const agentRunId = `phase4-work-item-convert-run-${runId}`;
    await agentState.createRun(
      thread.id,
      {
        id: agentRunId,
        status: "completed",
        risk_level: "medium",
        steps: []
      },
      owner.id
    );

    const sourcePackage = await agentState.createCoachingPackage(
      thread.id,
      {
        review: {
          runId: agentRunId,
          type: "daily_guidance",
          title: "Work item conversion source review",
          summary: "A source review that should be revised from a workspace item.",
          adherenceScore: 68,
          focusAreas: ["recovery"],
          recommendationTags: ["daily_guidance"],
          inputSnapshot: { completionRate: 68, sleepHours: 6.2 },
          resultSnapshot: { recommendation: "Keep the original advice moderate." },
          evidence: { completionRate: 68, sleepHours: 6.2 }
        },
        proposalGroup: {
          runId: agentRunId,
          title: "Work item conversion source package",
          summary: "Original package waiting for a safer revision.",
          preview: { summary: "Original package" },
          riskLevel: "medium"
        },
        proposals: [
          {
            actionType: "create_advice_snapshot",
            entityType: "advice_snapshot",
            title: "Create original advice",
            summary: "Persist the original advice.",
            payload: {
              type: "daily_guidance",
              priority: "medium",
              summary: "Keep the original advice moderate.",
              reasoningTags: ["phase4_work_item_conversion"],
              actionItems: ["Keep intensity moderate."],
              riskFlags: []
            },
            preview: { summary: "Keep the original advice moderate." },
            riskLevel: "medium"
          }
        ]
      },
      owner.id
    );

    const workItem = await prisma.agentWorkItem.create({
      data: {
        userId: owner.id,
        type: "revision_suggested",
        status: "pending",
        priority: "high",
        source: "feedback",
        title: "A safer revision is suggested",
        summary: "Convert this item into a safer pending revision package.",
        reason: "Recent feedback was negative or safety-related.",
        payload: { feedbackType: "too_hard" },
        requestId: `phase4-work-item-convert-${runId}`,
        relatedThreadId: thread.id,
        relatedReviewId: sourcePackage.review.id,
        relatedProposalGroupId: sourcePackage.proposal_group.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });

    await assert.rejects(
      () => workItems.convertWorkItem(workItem.id, other.id),
      (error: unknown) => error instanceof Error && error.message.includes("Agent work item not found")
    );

    const converted = await workItems.convertWorkItem(workItem.id, owner.id, {
      requestId: `phase4-work-item-convert-explicit-${runId}`,
      revisionReason: "too_hard"
    });
    assert.equal(converted.workItem.status, "converted");
    assert.equal(converted.workItem.converted_entity_type, "agent_proposal_group");
    assert.equal(converted.conversion.type, "revision");
    assert.equal(converted.conversion.proposal_group.status, "pending");
    assert.equal(converted.conversion.proposal_group.risk_level, "low");

    const oldGroup = await prisma.agentProposalGroup.findUniqueOrThrow({
      where: { id: sourcePackage.proposal_group.id }
    });
    assert.equal(oldGroup.status, "superseded");

    await assert.rejects(
      () => workItems.convertWorkItem(workItem.id, owner.id),
      (error: unknown) => error instanceof Error && error.message.includes("converted")
    );

    const lockedWorkItem = await prisma.agentWorkItem.create({
      data: {
        userId: owner.id,
        type: "revision_suggested",
        status: "processing",
        priority: "high",
        source: "feedback",
        title: "Locked revision item",
        summary: "This item should not be convertible outside pending or opened states.",
        reason: "A future worker has locked the item.",
        payload: { feedbackType: "too_hard" },
        requestId: `phase4-work-item-locked-${runId}`,
        relatedThreadId: thread.id,
        relatedReviewId: sourcePackage.review.id,
        relatedProposalGroupId: sourcePackage.proposal_group.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });

    await assert.rejects(
      () => workItems.convertWorkItem(lockedWorkItem.id, owner.id),
      (error: unknown) => error instanceof Error && error.message.includes("processing")
    );

    const events = await prisma.agentProductEvent.findMany({
      where: { userId: owner.id },
      orderBy: { createdAt: "asc" }
    });
    assert.ok(events.some((event) => event.eventType === "revision_requested"));
    assert.ok(events.some((event) => event.eventType === "work_item_converted" && event.entityId === workItem.id));

    const expiredWorkItem = await prisma.agentWorkItem.create({
      data: {
        userId: owner.id,
        type: "revision_suggested",
        status: "pending",
        priority: "high",
        source: "feedback",
        title: "Expired revision item",
        summary: "This item should expire before conversion.",
        reason: "The user waited too long.",
        payload: { feedbackType: "too_hard" },
        requestId: `phase4-work-item-expired-${runId}`,
        relatedThreadId: thread.id,
        relatedReviewId: sourcePackage.review.id,
        relatedProposalGroupId: sourcePackage.proposal_group.id,
        expiresAt: new Date(Date.now() - 1000)
      }
    });

    await assert.rejects(
      () => workItems.convertWorkItem(expiredWorkItem.id, owner.id),
      (error: unknown) => error instanceof Error && error.message.includes("expired")
    );
    const persistedExpiredItem = await prisma.agentWorkItem.findUniqueOrThrow({
      where: { id: expiredWorkItem.id }
    });
    assert.equal(persistedExpiredItem.status, "expired");
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
