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
  : "Set backend/.env DATABASE_URL to run real database Phase 3 memory tests.";

function createServices() {
  const prisma = new PrismaService();
  const outcomeService = new CoachingOutcomeService(prisma);
  const appStore = new AppStoreService(prisma, outcomeService);
  const agentState = new AgentStateService(prisma, appStore, outcomeService);

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
  return appStore.createUser(`phase3-${label}-${runId}@example.test`, `password-${runId}`, `Phase3 ${label}`);
}

async function createThreadAndRun(agentState: AgentStateService, userId: string) {
  const thread = await agentState.createThread("Phase 3 memory test", userId);
  const runId = `phase3-run-${randomUUID()}`;
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

async function createMemoryProposal(agentState: AgentStateService, threadId: string, runId: string, userId: string) {
  const [proposal] = await agentState.createProposals(
    threadId,
    {
      runId,
      proposals: [
        {
          actionType: "create_coaching_memory",
          entityType: "coaching_memory",
          title: "新增教练记忆",
          summary: "记住用户不喜欢跑步，更偏好低冲击有氧。",
          payload: {
            memoryType: "training_preference",
            title: "低冲击有氧偏好",
            summary: "用户不喜欢跑步，更偏好低冲击有氧。",
            value: {
              disliked: ["running"],
              preferred: ["incline walk", "cycling"]
            },
            confidence: 80,
            sourceType: "chat",
            reason: "用户明确要求记住训练偏好。"
          },
          preview: {
            记忆类型: "training_preference",
            摘要: "用户不喜欢跑步，更偏好低冲击有氧。"
          },
          riskLevel: "medium"
        }
      ]
    },
    userId
  );

  return proposal;
}

test("phase3 memory proposal writes memory and event only after confirmation", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const user = await createUser(appStore, runId, "confirm");
    const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, user.id);
    const proposal = await createMemoryProposal(agentState, threadId, agentRunId, user.id);

    assert.equal((await appStore.getMemorySummary(user.id)).activeMemories.length, 0);

    const confirmed = await agentState.confirmProposal(proposal.id, `idem-${runId}`, user.id);
    assert.equal(confirmed.proposal.status, "executed");

    const summary = await appStore.getMemorySummary(user.id);
    assert.equal(summary.activeMemories.length, 1);
    assert.equal(summary.activeMemories[0].memoryType, "training_preference");
    assert.equal(summary.activeMemories[0].confidence, 80);
    assert.equal(summary.recentEvents.length, 1);
    assert.equal(summary.recentEvents[0].eventType, "created");
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});

test("phase3 rejected memory proposal does not write long-lived memory", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const user = await createUser(appStore, runId, "reject");
    const { threadId, runId: agentRunId } = await createThreadAndRun(agentState, user.id);
    const proposal = await createMemoryProposal(agentState, threadId, agentRunId, user.id);

    await agentState.rejectProposal(proposal.id, user.id);

    const summary = await appStore.getMemorySummary(user.id);
    assert.equal(summary.activeMemories.length, 0);
    assert.equal(summary.recentEvents.length, 0);
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});

test("phase3 partial memory updates do not overwrite stable fields", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const user = await createUser(appStore, runId, "partial-update");
    const memory = await appStore.createCoachingMemory(user.id, {
      memoryType: "equipment_constraint",
      title: "Home equipment",
      summary: "User trains mostly at home.",
      value: { equipment: ["dumbbells"] },
      confidence: 65,
      sourceType: "chat"
    });

    await appStore.updateCoachingMemory(user.id, memory.id, {
      summary: "User trains mostly at home and has adjustable dumbbells.",
      confidence: 82,
      reason: "User clarified available equipment."
    });

    const summary = await appStore.getMemorySummary(user.id);
    assert.equal(summary.activeMemories.length, 1);
    assert.equal(summary.activeMemories[0].memoryType, "equipment_constraint");
    assert.equal(summary.activeMemories[0].title, "Home equipment");
    assert.equal(summary.activeMemories[0].summary, "User trains mostly at home and has adjustable dumbbells.");
    assert.equal(summary.activeMemories[0].confidence, 82);
    assert.equal(summary.recentEvents[0].eventType, "updated");
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});

test("phase3 memories are isolated by account and can be archived by owner only", { skip: skipWithoutDatabase }, async () => {
  const runId = randomUUID();
  const { prisma, appStore, agentState } = createServices();
  await prisma.$connect();

  try {
    await cleanupTestUsers(prisma, runId);
    const owner = await createUser(appStore, runId, "owner");
    const other = await createUser(appStore, runId, "other");
    const memory = await appStore.createCoachingMemory(owner.id, {
      memoryType: "recovery_pattern",
      title: "膝盖敏感",
      summary: "用户膝盖对跑跳敏感，优先低冲击安排。",
      value: { avoid: ["jumping", "running"] },
      confidence: 85,
      sourceType: "chat"
    });

    const ownerSummary = await appStore.getMemorySummary(owner.id);
    const otherSummary = await appStore.getMemorySummary(other.id);
    assert.equal(ownerSummary.activeMemories.length, 1);
    assert.equal(otherSummary.activeMemories.length, 0);

    await assert.rejects(
      () => appStore.archiveCoachingMemory(other.id, memory.id, "cross-account archive attempt"),
      (error: unknown) => error instanceof NotFoundException
    );

    await appStore.archiveCoachingMemory(owner.id, memory.id, "用户不再希望使用这条记忆。");
    const afterArchive = await appStore.getMemorySummary(owner.id);
    assert.equal(afterArchive.activeMemories.length, 0);
    assert.equal(afterArchive.recentEvents[0].eventType, "archived");
  } finally {
    await cleanupTestUsers(prisma, runId);
    await prisma.$disconnect();
  }
});
