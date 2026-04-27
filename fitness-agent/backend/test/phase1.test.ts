import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";
import { AgentStateService } from "../src/services/agent-state.service";
import { getProposalActionState } from "../../frontend/lib/proposal-state";

function makeProposal(overrides: Record<string, unknown> = {}) {
  const now = new Date("2099-04-20T12:00:00.000Z");
  return {
    id: "proposal-1",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    status: "pending",
    actionType: "update_plan_day",
    entityType: "workout_plan_day",
    entityId: "day-1",
    title: "Update plan day",
    summary: "Change Wednesday to recovery walk.",
    payload: { dayId: "day-1", focus: "Recovery walk" },
    preview: { dayLabel: "Wednesday", nextFocus: "Recovery walk" },
    riskLevel: "medium",
    requiresConfirmation: true,
    expiresAt: new Date("2099-04-20T14:00:00.000Z"),
    executedAt: null,
    basePlanId: null,
    basePlanVersion: null,
    basePlanUpdatedAt: null,
    expectedDayId: null,
    expectedDayUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createService() {
  const now = new Date("2099-04-20T12:00:00.000Z");
  const prisma = {
    agentThread: {
      findFirst: async () => ({
        id: "thread-1",
        userId: "user-1",
        title: "Health Agent Chat"
      })
    },
    agentRun: {
      findFirst: async () => ({
        id: "run-1",
        threadId: "thread-1",
        status: "completed",
        riskLevel: "high",
        createdAt: now,
        steps: []
      })
    },
    coachingReviewSnapshot: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "review-1",
        userId: "user-1",
        threadId: "thread-1",
        runId: data.runId ?? "run-1",
        type: data.type ?? "weekly_review",
        status: data.status ?? "packaged",
        periodStart: null,
        periodEnd: null,
        title: data.title ?? "Weekly review",
        summary: data.summary ?? "Review summary",
        adherenceScore: data.adherenceScore ?? 70,
        riskFlags: [],
        focusAreas: [],
        recommendationTags: [],
        inputSnapshot: {},
        resultSnapshot: {},
        createdAt: now,
        updatedAt: now
      }),
      update: async () => ({})
    },
    agentProposalGroup: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "group-1",
        threadId: "thread-1",
        runId: data.runId ?? "run-1",
        userId: "user-1",
        reviewSnapshotId: data.reviewSnapshotId ?? "review-1",
        status: data.status ?? "pending",
        title: data.title ?? "Weekly package",
        summary: data.summary ?? "Apply weekly coaching package.",
        preview: {},
        riskLevel: data.riskLevel ?? "high",
        expiresAt: new Date("2099-04-20T16:00:00.000Z"),
        executedAt: null,
        createdAt: now,
        updatedAt: now,
        proposals: []
      }),
      findFirst: async () => ({
        id: "group-1",
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        reviewSnapshotId: "review-1",
        status: "pending",
        title: "Weekly package",
        summary: "Apply weekly coaching package.",
        preview: {},
        riskLevel: "high",
        expiresAt: new Date("2099-04-20T16:00:00.000Z"),
        executedAt: null,
        createdAt: now,
        updatedAt: now,
        proposals: []
      }),
      findUniqueOrThrow: async () => ({
        id: "group-1",
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        reviewSnapshotId: "review-1",
        status: "executed",
        title: "Weekly package",
        summary: "Apply weekly coaching package.",
        preview: {},
        riskLevel: "high",
        expiresAt: new Date("2099-04-20T16:00:00.000Z"),
        executedAt: new Date("2099-04-20T13:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
        proposals: []
      }),
      updateMany: async () => ({ count: 1 }),
      update: async () => ({})
    },
    agentActionProposal: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        makeProposal({
          id: String(data.title ?? "proposal-created"),
          runId: String(data.runId ?? "run-1"),
          proposalGroupId: String(data.proposalGroupId ?? "group-1"),
          title: String(data.title ?? "Created proposal"),
          summary: String(data.summary ?? "Created summary"),
          actionType: String(data.actionType ?? "create_advice_snapshot"),
          entityType: String(data.entityType ?? "advice_snapshot"),
          payload: data.payload ?? {},
          preview: data.preview ?? {}
        }),
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
      findUniqueOrThrow: async () => makeProposal({ status: "approved" }),
      findUnique: async () => makeProposal({ status: "approved" }),
      findFirst: async () => makeProposal(),
      count: async () => 0
    },
    agentActionExecution: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => ({})
    },
    coachingOutcome: {
      findUnique: async () => null,
      upsert: async () => ({ id: "outcome-1" })
    },
    $transaction: async (input: unknown) => {
      if (typeof input === "function") {
        return input(prisma);
      }

      return Promise.all(input as Promise<unknown>[]);
    }
  };

  const appStore = {
    getUser: async (userId?: string) => ({ id: userId ?? "user-1" }),
    getCurrentPlanSnapshot: async () => ({
      plan: {
        id: "plan-1",
        title: "Current plan",
        goal: "fat_loss",
        status: "active",
        version: 1,
        weekOf: "2099-04-20T00:00:00.000Z",
        createdAt: "2099-04-20T00:00:00.000Z",
        updatedAt: "2099-04-20T00:00:00.000Z"
      },
      days: [
        {
          id: "day-1",
          dayLabel: "Wednesday",
          focus: "Lower body",
          duration: "45 min",
          exercises: ["Squat"],
          recoveryTip: "Stretch",
          isCompleted: false,
          sortOrder: 0,
          updatedAt: "2099-04-20T00:00:00.000Z"
        }
      ]
    })
  };
  const outcomeService = {
    getOutcomeForProposalGroup: async () => null,
    createPendingOutcomeForExecutedPackage: async () => ({ id: "outcome-1" })
  };

  return {
    prisma,
    appStore,
    service: new AgentStateService(prisma as never, appStore as never, outcomeService as never)
  };
}

test("confirmProposal resumes execution when the proposal is already approved", async () => {
  const { service, prisma } = createService();

  (service as any).getProposalForActor = async () => ({
    actor: { id: "user-1" },
    proposal: makeProposal({ status: "approved", actionType: "update_plan_day" })
  });

  let findCount = 0;
  prisma.agentActionProposal.findUniqueOrThrow = async () => {
    findCount += 1;
    return findCount === 1
      ? makeProposal({ status: "approved", actionType: "update_plan_day" })
      : makeProposal({ status: "executed", actionType: "update_plan_day", executedAt: new Date("2099-04-20T12:30:00.000Z") });
  };

  (service as any).executeApprovedProposal = async () => ({
    ok: true,
    status: "succeeded",
    result: { ok: true, id: "day-1" }
  });

  const result = await service.confirmProposal("proposal-1", "idem-1", "user-1");

  assert.equal(result.execution.ok, true);
  assert.equal(result.execution.status, "succeeded");
  assert.equal(result.proposal.status, "executed");
});

test("confirmProposal rejects terminal proposal states", async () => {
  const { service } = createService();

  (service as any).getProposalForActor = async () => ({
    actor: { id: "user-1" },
    proposal: makeProposal({ status: "rejected" })
  });

  await assert.rejects(
    () => service.confirmProposal("proposal-1", "idem-1", "user-1"),
    (error: unknown) => error instanceof ConflictException && error.message.includes("can no longer be confirmed")
  );
});

test("assertProposalFresh fails when the active plan has changed", async () => {
  const { service, prisma, appStore } = createService();

  prisma.agentActionProposal.findUnique = async () =>
    makeProposal({
      basePlanId: "plan-old",
      basePlanVersion: 1,
      basePlanUpdatedAt: new Date("2099-04-20T00:00:00.000Z")
    });

  appStore.getCurrentPlanSnapshot = async () => ({
    plan: {
      id: "plan-new",
      title: "Replacement plan",
      goal: "fat_loss",
      status: "active",
      version: 2,
      weekOf: "2099-04-20T00:00:00.000Z",
      createdAt: "2099-04-20T00:00:00.000Z",
      updatedAt: "2099-04-20T01:00:00.000Z"
    },
    days: []
  });

  await assert.rejects(
    () => (service as any).assertProposalFresh("proposal-1", "user-1"),
    (error: unknown) => error instanceof ConflictException && error.message.includes("active plan has changed")
  );
});

test("proposal action state exposes resumable approved proposals", () => {
  assert.deepEqual(getProposalActionState("pending"), {
    canAct: true,
    canReject: true,
    approveLabel: "确认执行",
    rejectLabel: "拒绝"
  });

  assert.deepEqual(getProposalActionState("approved"), {
    canAct: true,
    canReject: false,
    approveLabel: "继续执行",
    rejectLabel: "已锁定"
  });

  assert.deepEqual(getProposalActionState("executed"), {
    canAct: false,
    canReject: false,
    approveLabel: "已结束",
    rejectLabel: "已结束"
  });
});

test("createCoachingPackage persists the review, group, and proposals in one service call", async () => {
  const { service } = createService();

  const result = await service.createCoachingPackage(
    "thread-1",
    {
      review: {
        runId: "run-1",
        type: "weekly_review",
        title: "Weekly review",
        summary: "Review summary"
      },
      proposalGroup: {
        runId: "run-1",
        title: "Weekly package",
        summary: "Package summary",
        preview: { completionRate: "70%" },
        riskLevel: "high"
      },
      proposals: [
        {
          actionType: "create_advice_snapshot",
          entityType: "advice_snapshot",
          title: "Create advice snapshot",
          summary: "Persist the advice snapshot.",
          payload: { summary: "Advice" },
          preview: { summary: "Advice" },
          riskLevel: "medium"
        }
      ]
    },
    "user-1"
  );

  assert.equal(result.review.status, "packaged");
  assert.equal(result.proposal_group.review_snapshot_id, "review-1");
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].proposal_group_id, "group-1");
});

test("executeProposalGroup applies grouped proposals and marks the review as applied", async () => {
  const { service, prisma } = createService();
  const updates: string[] = [];

  (service as any).getProposalGroupForActor = async () => ({
    actor: { id: "user-1" },
    proposalGroup: {
      id: "group-1",
      threadId: "thread-1",
      runId: "run-1",
      userId: "user-1",
      reviewSnapshotId: "review-1",
      status: "pending",
      title: "Weekly package",
      summary: "Apply weekly coaching package.",
      preview: {},
      riskLevel: "high",
      expiresAt: new Date("2099-04-20T16:00:00.000Z"),
      executedAt: null,
      createdAt: new Date("2099-04-20T12:00:00.000Z"),
      updatedAt: new Date("2099-04-20T12:00:00.000Z"),
      proposals: [
        makeProposal({
          id: "proposal-a",
          proposalGroupId: "group-1",
          status: "pending",
          actionType: "create_advice_snapshot",
          payload: { summary: "Advice" }
        }),
        makeProposal({
          id: "proposal-b",
          proposalGroupId: "group-1",
          status: "pending",
          actionType: "generate_diet_snapshot",
          payload: { totalCalorie: 2000, targetCalorie: 2000, meals: [], nutritionDetail: {}, agentTips: [] }
        })
      ]
    }
  });

  (service as any).assertProposalFresh = async () => undefined;
  (service as any).dispatchActionWithinTransaction = async (actionType: string) => ({ ok: true, actionType });
  prisma.agentProposalGroup.updateMany = async () => {
    updates.push("group:approved");
    return { count: 1 };
  };

  prisma.$transaction = async (callback: (tx: typeof prisma) => Promise<unknown>) =>
    callback({
      ...prisma,
      agentProposalGroup: {
        ...prisma.agentProposalGroup,
        update: async ({ data }: { data: { status: string } }) => {
          updates.push(`group:${data.status}`);
          return {};
        }
      },
      agentActionProposal: {
        ...prisma.agentActionProposal,
        update: async ({ where }: { where: { id: string } }) => {
          updates.push(`proposal:${where.id}`);
          return {};
        }
      },
      coachingReviewSnapshot: {
        update: async ({ data }: { data: { status: string } }) => {
          updates.push(`review:${data.status}`);
          return {};
        }
      }
    } as typeof prisma);

  const result = await service.executeProposalGroup("group-1", "idem-phase2", "user-1");

  assert.equal(result.ok, true);
  assert.equal(result.actions.length, 2);
  assert.ok(updates.includes("group:approved"));
  assert.ok(updates.includes("group:executed"));
  assert.ok(updates.includes("proposal:proposal-a"));
  assert.ok(updates.includes("proposal:proposal-b"));
  assert.ok(updates.includes("review:applied"));
});

test("executeProposalGroup returns an existing idempotent package execution", async () => {
  const { service, prisma } = createService();

  (service as any).getProposalGroupForActor = async () => ({
    actor: { id: "user-1" },
    proposalGroup: {
      id: "group-1",
      threadId: "thread-1",
      runId: "run-1",
      userId: "user-1",
      reviewSnapshotId: "review-1",
      status: "executed",
      title: "Weekly package",
      summary: "Apply weekly coaching package.",
      preview: {},
      riskLevel: "high",
      expiresAt: new Date("2099-04-20T16:00:00.000Z"),
      executedAt: new Date("2099-04-20T13:00:00.000Z"),
      createdAt: new Date("2099-04-20T12:00:00.000Z"),
      updatedAt: new Date("2099-04-20T13:00:00.000Z"),
      proposals: [
        makeProposal({ id: "proposal-a", proposalGroupId: "group-1", actionType: "create_advice_snapshot" }),
        makeProposal({ id: "proposal-b", proposalGroupId: "group-1", actionType: "generate_diet_snapshot" })
      ]
    }
  });

  (prisma.agentActionProposal as any).count = async () => 2;
  (prisma.agentActionExecution as any).findMany = async () => [
    {
      proposalId: "proposal-a",
      status: "succeeded",
      resultPayload: { ok: true },
      errorMessage: null,
      proposal: makeProposal({ id: "proposal-a", actionType: "create_advice_snapshot" })
    },
    {
      proposalId: "proposal-b",
      status: "succeeded",
      resultPayload: { ok: true },
      errorMessage: null,
      proposal: makeProposal({ id: "proposal-b", actionType: "generate_diet_snapshot" })
    }
  ];

  const result = await service.executeProposalGroup("group-1", "idem-phase2", "user-1");

  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
  assert.equal(result.actions.length, 2);
});
