import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { AppStoreService } from "../src/store/app-store.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AgentWorkItemService } from "../src/services/agent-work-item.service";
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
  : "Set backend/.env DATABASE_URL to run real database Phase 4 work item tests.";

function createServices() {
  const prisma = new PrismaService();
  const outcomeService = new CoachingOutcomeService(prisma);
  const appStore = new AppStoreService(prisma, outcomeService);
  const workItems = new AgentWorkItemService(prisma, appStore);

  return { prisma, appStore, workItems };
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
