import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppStoreService, CoachSummaryRecord } from "../store/app-store.service";
import { AgentProductEventService } from "./agent-product-event.service";
import { AgentStateService } from "./agent-state.service";

const activeStatuses = ["pending", "opened"];
const dismissCooldownMs = 24 * 60 * 60 * 1000;
const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

type WorkItemPriority = "low" | "medium" | "high";
type WorkItemSource = "dashboard_refresh" | "scheduled_check" | "chat" | "outcome" | "feedback";
type TransactionClient = Prisma.TransactionClient | PrismaClient;

interface WorkItemCandidate {
  type: string;
  priority: WorkItemPriority;
  source: WorkItemSource;
  title: string;
  summary: string;
  reason: string;
  payload: Record<string, unknown>;
  relatedThreadId?: string | null;
  relatedReviewId?: string | null;
  relatedProposalGroupId?: string | null;
  relatedOutcomeId?: string | null;
  expiresAt?: Date | null;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isoOrNull(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function dateToIso(value?: string | Date | null) {
  return value ? new Date(value).toISOString() : null;
}

function hoursSince(value?: string | Date | null) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - new Date(value).getTime()) / (60 * 60 * 1000);
}

function addHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function addDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function relatedWhere(candidate: Pick<WorkItemCandidate, "relatedThreadId" | "relatedReviewId" | "relatedProposalGroupId" | "relatedOutcomeId">) {
  return {
    relatedThreadId: candidate.relatedThreadId ?? null,
    relatedReviewId: candidate.relatedReviewId ?? null,
    relatedProposalGroupId: candidate.relatedProposalGroupId ?? null,
    relatedOutcomeId: candidate.relatedOutcomeId ?? null
  };
}

function sortWorkItems<T extends { priority: string; createdAt: Date }>(items: T[]) {
  return [...items].sort((left, right) => {
    const priorityDelta = (priorityRank[left.priority] ?? 99) - (priorityRank[right.priority] ?? 99);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

@Injectable()
export class AgentWorkItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appStore: AppStoreService,
    private readonly productEvents: AgentProductEventService = new AgentProductEventService(prisma),
    @Optional() private readonly agentState?: AgentStateService
  ) {}

  private async getActor(userId?: string) {
    return this.appStore.getUser(userId);
  }

  private mapWorkItem(item: {
    id: string;
    type: string;
    status: string;
    priority: string;
    source: string;
    title: string;
    summary: string;
    reason: string;
    payload: Prisma.JsonValue;
    requestId: string | null;
    relatedThreadId: string | null;
    relatedReviewId: string | null;
    relatedProposalGroupId: string | null;
    relatedOutcomeId: string | null;
    convertedEntityType: string | null;
    convertedEntityId: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      priority: item.priority,
      source: item.source,
      title: item.title,
      summary: item.summary,
      reason: item.reason,
      payload: item.payload,
      request_id: item.requestId,
      related_thread_id: item.relatedThreadId,
      related_review_id: item.relatedReviewId,
      related_proposal_group_id: item.relatedProposalGroupId,
      related_outcome_id: item.relatedOutcomeId,
      converted_entity_type: item.convertedEntityType,
      converted_entity_id: item.convertedEntityId,
      expires_at: isoOrNull(item.expiresAt),
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString()
    };
  }

  async listWorkItems(userId?: string, includeFinal = false) {
    const actor = await this.getActor(userId);
    const items = await this.prisma.agentWorkItem.findMany({
      where: {
        userId: actor.id,
        status: includeFinal ? undefined : { in: activeStatuses }
      },
      orderBy: { createdAt: "desc" },
      take: includeFinal ? 100 : 50
    });

    return sortWorkItems(items)
      .slice(0, includeFinal ? 50 : 20)
      .map((item) => this.mapWorkItem(item));
  }

  async buildWorkspaceSummary(userId?: string) {
    const actor = await this.getActor(userId);
    const [coachSummary, pendingWorkItems, latestProductEvents, latestQualityChecks] = await Promise.all([
      this.appStore.getCoachSummary(actor.id),
      this.listWorkItems(actor.id),
      this.prisma.agentProductEvent.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: "desc" },
        take: 8
      }),
      this.prisma.agentQualityCheck.findMany({
        where: { userId: actor.id },
        orderBy: { createdAt: "desc" },
        take: 8
      })
    ]);

    return {
      coachSummary,
      memorySummary: coachSummary.memorySummary,
      recentOutcomes: coachSummary.recentOutcomes,
      recentFeedback: coachSummary.recentRecommendationFeedback,
      pendingPackage: coachSummary.pendingCoachingPackage,
      pendingWorkItems,
      latestQualityChecks: latestQualityChecks.map((check) => ({
        id: check.id,
        thread_id: check.threadId,
        run_id: check.runId,
        review_snapshot_id: check.reviewSnapshotId,
        proposal_group_id: check.proposalGroupId,
        scope: check.scope,
        status: check.status,
        score: check.score,
        blocked_reasons: check.blockedReasons,
        downgrade_reasons: check.downgradeReasons,
        passed_policy_labels: check.passedPolicyLabels,
        evidence: check.evidence,
        created_at: check.createdAt.toISOString()
      })),
      latestProductEvents: latestProductEvents.map((event) => ({
        id: event.id,
        event_type: event.eventType,
        source: event.source,
        entity_type: event.entityType,
        entity_id: event.entityId,
        request_id: event.requestId,
        payload: event.payload,
        created_at: event.createdAt.toISOString()
      })),
      todayPlan: coachSummary.currentPlan.days.find((day) => !day.isCompleted) ?? coachSummary.currentPlan.days[0] ?? null,
      logGapSummary: this.buildLogGapSummary(coachSummary),
      recommendedEntryPoints: this.buildRecommendedEntryPoints(coachSummary, pendingWorkItems.length)
    };
  }

  async refreshWorkItems(userId?: string, options?: { requestId?: string; source?: string }) {
    const actor = await this.getActor(userId);
    const requestId = options?.requestId?.trim() || randomUUID();
    const source = this.normalizeSource(options?.source);
    const coachSummary = await this.appStore.getCoachSummary(actor.id);
    const candidates = this.buildCandidates(coachSummary, source);
    const expired = await this.expireStaleWorkItems(actor.id);
    const result = {
      requestId,
      created: [] as Array<ReturnType<AgentWorkItemService["mapWorkItem"]>>,
      updated: [] as Array<ReturnType<AgentWorkItemService["mapWorkItem"]>>,
      skipped: [] as Array<{ type: string; reason: string }>,
      expired
    };

    for (const candidate of candidates) {
      const cooldown = await this.hasDismissCooldown(actor.id, candidate);
      if (cooldown) {
        result.skipped.push({ type: candidate.type, reason: "recently_dismissed" });
        continue;
      }

      const existing = await this.prisma.agentWorkItem.findFirst({
        where: {
          userId: actor.id,
          type: candidate.type,
          status: { in: activeStatuses },
          ...relatedWhere(candidate)
        }
      });

      if (existing) {
        const updated = await this.prisma.agentWorkItem.update({
          where: { id: existing.id },
          data: {
            priority: candidate.priority,
            title: candidate.title,
            summary: candidate.summary,
            reason: candidate.reason,
            payload: asJson(candidate.payload),
            requestId,
            expiresAt: candidate.expiresAt
          }
        });
        result.updated.push(this.mapWorkItem(updated));
        continue;
      }

      try {
        const created = await this.prisma.agentWorkItem.create({
          data: {
            userId: actor.id,
            type: candidate.type,
            status: "pending",
            priority: candidate.priority,
            source: candidate.source,
            title: candidate.title,
            summary: candidate.summary,
            reason: candidate.reason,
            payload: asJson(candidate.payload),
            requestId,
            relatedThreadId: candidate.relatedThreadId ?? undefined,
            relatedReviewId: candidate.relatedReviewId ?? undefined,
            relatedProposalGroupId: candidate.relatedProposalGroupId ?? undefined,
            relatedOutcomeId: candidate.relatedOutcomeId ?? undefined,
            expiresAt: candidate.expiresAt
          }
        });
        await this.productEvents.record(actor.id, {
          eventType: "work_item_created",
          source: candidate.source,
          entityType: "agent_work_item",
          entityId: created.id,
          requestId,
          payload: {
            type: candidate.type,
            priority: candidate.priority,
            related: relatedWhere(candidate)
          }
        });
        result.created.push(this.mapWorkItem(created));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          result.skipped.push({ type: candidate.type, reason: "deduped_by_database" });
          continue;
        }
        throw error;
      }
    }

    return {
      ...result,
      pending: await this.listWorkItems(actor.id)
    };
  }

  async openWorkItem(workItemId: string, userId?: string) {
    const actor = await this.getActor(userId);
    const item = await this.getWorkItemForActor(workItemId, actor.id);
    this.assertActionable(item.status, "open");
    await this.assertNotExpired(item);

    const updated = item.status === "opened"
      ? item
      : await this.prisma.agentWorkItem.update({
          where: { id: item.id },
          data: { status: "opened" }
        });

    await this.productEvents.record(actor.id, {
      eventType: "work_item_opened",
      source: updated.source,
      entityType: "agent_work_item",
      entityId: updated.id,
      requestId: updated.requestId,
      payload: { type: updated.type, previousStatus: item.status }
    });

    return {
      workItem: this.mapWorkItem(updated),
      navigation: this.buildNavigationTarget(updated.type)
    };
  }

  async dismissWorkItem(workItemId: string, userId?: string, options?: { reason?: string; requestId?: string }) {
    const actor = await this.getActor(userId);
    const item = await this.getWorkItemForActor(workItemId, actor.id);
    this.assertActionable(item.status, "dismiss");
    await this.assertNotExpired(item);

    const updated = await this.prisma.agentWorkItem.update({
      where: { id: item.id },
      data: { status: "dismissed" }
    });

    await this.productEvents.record(actor.id, {
      eventType: "work_item_dismissed",
      source: updated.source,
      entityType: "agent_work_item",
      entityId: updated.id,
      requestId: options?.requestId ?? updated.requestId,
      payload: {
        type: updated.type,
        reason: options?.reason?.trim() || "user_dismissed"
      }
    });

    return this.mapWorkItem(updated);
  }

  async convertWorkItem(workItemId: string, userId?: string, options?: { requestId?: string; revisionReason?: string }) {
    const actor = await this.getActor(userId);
    if (!this.agentState) {
      throw new ConflictException("Work item conversion is not available in this runtime.");
    }
    const agentState = this.agentState;

    const conversion = await this.prisma.$transaction(async (tx) => {
      await this.lockWorkItem(tx, workItemId);
      const item = await this.getWorkItemForActorInTx(tx, workItemId, actor.id);
      this.assertActionable(item.status, "convert");
      if (await this.expireIfNeededInTx(tx, item)) {
        return { expired: true as const };
      }

      if (item.type !== "revision_suggested") {
        throw new ConflictException(`Work item type ${item.type} cannot be converted yet.`);
      }

      const reviewId = await this.resolveRevisionReviewId(tx, item, actor.id);
      const requestId = options?.requestId?.trim() || item.requestId || randomUUID();
      const revision = await agentState.reviseCoachingReview(
        reviewId,
        {
          requestId,
          revisionReason: options?.revisionReason?.trim() || "work_item_revision",
          sourceProposalGroupId: item.relatedProposalGroupId ?? undefined
        },
        actor.id,
        tx
      );

      const updated = await tx.agentWorkItem.update({
        where: { id: item.id },
        data: {
          status: "converted",
          convertedEntityType: "agent_proposal_group",
          convertedEntityId: revision.proposal_group.id
        }
      });

      await this.productEvents.record(
        actor.id,
        {
          eventType: "work_item_converted",
          source: updated.source,
          entityType: "agent_work_item",
          entityId: updated.id,
          requestId,
          payload: {
            type: updated.type,
            convertedEntityType: "agent_proposal_group",
            convertedEntityId: revision.proposal_group.id,
            sourceReviewId: revision.source_review.id,
            sourceProposalGroupId: revision.source_proposal_group?.id ?? null
          }
        },
        tx
      );

      return {
        expired: false as const,
        workItem: this.mapWorkItem(updated),
        conversion: {
          type: "revision",
          request_id: requestId,
          review: revision.review,
          proposal_group: revision.proposal_group,
          proposals: revision.proposals,
          quality_check: revision.quality_check,
          superseded_proposal_group_ids: revision.superseded_proposal_group_ids
        }
      };
    });

    if (conversion.expired) {
      throw new ConflictException("This work item has expired. Refresh the workspace and try again.");
    }

    return {
      workItem: conversion.workItem,
      conversion: conversion.conversion
    };
  }

  private normalizeSource(source?: string): WorkItemSource {
    if (source === "scheduled_check" || source === "chat" || source === "outcome" || source === "feedback") {
      return source;
    }
    return "dashboard_refresh";
  }

  private async getWorkItemForActor(workItemId: string, userId: string) {
    const item = await this.prisma.agentWorkItem.findFirst({
      where: { id: workItemId, userId }
    });

    if (!item) {
      throw new NotFoundException("Agent work item not found.");
    }

    return item;
  }

  private async getWorkItemForActorInTx(client: TransactionClient, workItemId: string, userId: string) {
    const item = await client.agentWorkItem.findFirst({
      where: { id: workItemId, userId }
    });

    if (!item) {
      throw new NotFoundException("Agent work item not found.");
    }

    return item;
  }

  private assertActionable(status: string, action: "open" | "dismiss" | "convert") {
    if (!activeStatuses.includes(status)) {
      throw new ConflictException(`This work item is ${status} and cannot be ${action}ed.`);
    }
  }

  private async assertNotExpired(item: { id: string; expiresAt: Date | null }) {
    if (!item.expiresAt || item.expiresAt.getTime() >= Date.now()) {
      return;
    }

    await this.prisma.agentWorkItem.update({
      where: { id: item.id },
      data: { status: "expired" }
    });
    throw new ConflictException("This work item has expired. Refresh the workspace and try again.");
  }

  private async expireIfNeededInTx(client: TransactionClient, item: { id: string; expiresAt: Date | null }) {
    if (!item.expiresAt || item.expiresAt.getTime() >= Date.now()) {
      return false;
    }

    await client.agentWorkItem.update({
      where: { id: item.id },
      data: { status: "expired" }
    });
    return true;
  }

  private async lockWorkItem(client: TransactionClient, workItemId: string) {
    const rows = await client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "AgentWorkItem" WHERE id = ${workItemId} FOR UPDATE`
    );
    if (rows.length === 0) {
      throw new NotFoundException("Agent work item not found.");
    }
  }

  private async resolveRevisionReviewId(
    client: TransactionClient,
    item: { relatedReviewId: string | null; relatedProposalGroupId: string | null },
    userId: string
  ) {
    if (item.relatedReviewId) {
      return item.relatedReviewId;
    }

    if (!item.relatedProposalGroupId) {
      throw new ConflictException("This revision work item is missing a related review or proposal group.");
    }

    const proposalGroup = await client.agentProposalGroup.findFirst({
      where: { id: item.relatedProposalGroupId, userId },
      select: { reviewSnapshotId: true }
    });

    if (!proposalGroup?.reviewSnapshotId) {
      throw new ConflictException("This revision work item is not tied to a review snapshot.");
    }

    return proposalGroup.reviewSnapshotId;
  }

  private async expireStaleWorkItems(userId: string) {
    const staleItems = await this.prisma.agentWorkItem.findMany({
      where: {
        userId,
        status: { in: activeStatuses },
        expiresAt: { lt: new Date() }
      }
    });

    if (staleItems.length === 0) {
      return [];
    }

    await this.prisma.agentWorkItem.updateMany({
      where: { id: { in: staleItems.map((item) => item.id) } },
      data: { status: "expired" }
    });

    return staleItems.map((item) => ({
      id: item.id,
      type: item.type,
      previous_status: item.status
    }));
  }

  private async hasDismissCooldown(userId: string, candidate: WorkItemCandidate) {
    const dismissed = await this.prisma.agentWorkItem.findFirst({
      where: {
        userId,
        type: candidate.type,
        status: "dismissed",
        updatedAt: { gt: new Date(Date.now() - dismissCooldownMs) },
        ...relatedWhere(candidate)
      },
      select: { id: true }
    });

    return Boolean(dismissed);
  }

  private buildCandidates(coachSummary: CoachSummaryRecord, source: WorkItemSource): WorkItemCandidate[] {
    const candidates: WorkItemCandidate[] = [];
    const latestCheckin = coachSummary.recentDailyCheckins[0];
    const latestWorkout = coachSummary.recentWorkoutLogs[0];
    const latestOutcome = coachSummary.recentOutcomes[0];
    const latestFeedback = coachSummary.recentRecommendationFeedback[0];

    if (coachSummary.needsWeeklyReview) {
      candidates.push({
        type: "weekly_review_due",
        priority: "high",
        source,
        title: "Weekly review is ready",
        summary: "Recent completion or recovery signals suggest reviewing this training cycle before changing plans.",
        reason: "needsWeeklyReview was true in the coach summary.",
        payload: {
          completionRate: coachSummary.completion.completionRate,
          completedDays: coachSummary.completion.completedDays,
          totalDays: coachSummary.completion.totalDays,
          latestSleepHours: latestCheckin?.sleepHours ?? null
        },
        expiresAt: addDays(7)
      });
    }

    if (coachSummary.currentPlan.days.length > 0 && !coachSummary.pendingCoachingPackage) {
      candidates.push({
        type: "daily_guidance_due",
        priority: latestCheckin && latestCheckin.sleepHours < 7 ? "high" : "medium",
        source,
        title: "Daily guidance can be prepared",
        summary: "Use today's plan and recent recovery data to generate advice that still requires confirmation before any write action.",
        reason: "An active plan exists and there is no pending coaching package blocking the next suggestion.",
        payload: {
          planId: coachSummary.currentPlan.plan?.id ?? null,
          nextDayId: coachSummary.currentPlan.days.find((day) => !day.isCompleted)?.id ?? null,
          latestCheckinAt: dateToIso(latestCheckin?.recordedAt)
        },
        expiresAt: addHours(30)
      });
    }

    if (hoursSince(latestCheckin?.recordedAt) > 30 || hoursSince(latestWorkout?.recordedAt) > 72) {
      candidates.push({
        type: "log_gap",
        priority: "medium",
        source,
        title: "Recent logs need a quick update",
        summary: "The agent has limited recent check-in or workout data, so the next suggestion should start by filling the gap.",
        reason: "Recent check-in or workout data is stale or missing.",
        payload: {
          latestCheckinAt: dateToIso(latestCheckin?.recordedAt),
          latestWorkoutAt: dateToIso(latestWorkout?.recordedAt),
          checkinHoursAgo: Number.isFinite(hoursSince(latestCheckin?.recordedAt)) ? Math.round(hoursSince(latestCheckin?.recordedAt)) : null,
          workoutHoursAgo: Number.isFinite(hoursSince(latestWorkout?.recordedAt)) ? Math.round(hoursSince(latestWorkout?.recordedAt)) : null
        },
        expiresAt: addDays(3)
      });
    }

    if (coachSummary.pendingCoachingPackage) {
      candidates.push({
        type: "pending_package",
        priority: "high",
        source,
        title: "A coaching package is waiting for confirmation",
        summary: coachSummary.pendingCoachingPackage.summary,
        reason: "A pending or approved coaching package exists and needs an explicit user decision.",
        payload: {
          title: coachSummary.pendingCoachingPackage.title,
          riskLevel: coachSummary.pendingCoachingPackage.riskLevel,
          policyLabels: coachSummary.pendingCoachingPackage.policyLabels
        },
        relatedThreadId: coachSummary.pendingCoachingPackage.threadId,
        relatedProposalGroupId: coachSummary.pendingCoachingPackage.id,
        expiresAt: addHours(12)
      });
    }

    for (const outcome of coachSummary.recentOutcomes) {
      if (outcome.status === "pending" && new Date(outcome.measurementEnd).getTime() <= Date.now()) {
        candidates.push({
          type: "outcome_refresh_due",
          priority: "medium",
          source: "outcome",
          title: "A coaching outcome can be refreshed",
          summary: "The measurement window has ended, so the result can be evaluated from follow-up logs.",
          reason: "A pending outcome has reached its measurement end.",
          payload: {
            measurementStart: outcome.measurementStart,
            measurementEnd: outcome.measurementEnd,
            proposalGroupId: outcome.proposalGroupId
          },
          relatedOutcomeId: outcome.id,
          relatedProposalGroupId: outcome.proposalGroupId ?? undefined,
          expiresAt: addDays(7)
        });
      }
    }

    if (latestOutcome?.status === "worsened" || latestFeedback?.feedbackType === "too_hard" || latestFeedback?.feedbackType === "unsafe_or_uncomfortable") {
      candidates.push({
        type: "revision_suggested",
        priority: "high",
        source: latestOutcome?.status === "worsened" ? "outcome" : "feedback",
        title: "A safer revision is suggested",
        summary: "Recent feedback or outcome signals suggest revising the previous recommendation before continuing.",
        reason: latestOutcome?.status === "worsened" ? "Recent outcome worsened." : "Recent feedback was negative or safety-related.",
        payload: {
          outcomeStatus: latestOutcome?.status ?? null,
          feedbackType: latestFeedback?.feedbackType ?? null,
            feedbackCreatedAt: latestFeedback?.createdAt ?? null
        },
        relatedOutcomeId: latestOutcome?.id,
        relatedProposalGroupId: latestOutcome?.proposalGroupId ?? latestFeedback?.proposalGroupId ?? undefined,
        relatedReviewId: latestOutcome?.reviewSnapshotId ?? latestFeedback?.reviewSnapshotId ?? undefined,
        expiresAt: addDays(7)
      });
    }

    return candidates;
  }

  private buildLogGapSummary(coachSummary: CoachSummaryRecord) {
    const latestCheckin = coachSummary.recentDailyCheckins[0];
    const latestWorkout = coachSummary.recentWorkoutLogs[0];

    return {
      latestCheckinAt: dateToIso(latestCheckin?.recordedAt),
      latestWorkoutAt: dateToIso(latestWorkout?.recordedAt),
      needsCheckin: hoursSince(latestCheckin?.recordedAt) > 30,
      needsWorkoutLog: hoursSince(latestWorkout?.recordedAt) > 72
    };
  }

  private buildRecommendedEntryPoints(coachSummary: CoachSummaryRecord, pendingWorkItemCount: number) {
    const entries: Array<{ key: string; label: string; route: string }> = [];

    if (pendingWorkItemCount > 0) {
      entries.push({ key: "work_items", label: "Review workspace items", route: "dashboard" });
    }
    if (coachSummary.pendingCoachingPackage) {
      entries.push({ key: "pending_package", label: "Confirm coaching package", route: "chat" });
    }
    if (coachSummary.needsWeeklyReview) {
      entries.push({ key: "weekly_review", label: "Start weekly review", route: "chat" });
    }
    if (entries.length === 0) {
      entries.push({ key: "daily_guidance", label: "Ask for daily guidance", route: "chat" });
    }

    return entries;
  }

  private buildNavigationTarget(type: string) {
    if (type === "log_gap") {
      return { route: "logs", intent: "fill_recent_logs" };
    }

    if (type === "daily_guidance_due" || type === "weekly_review_due" || type === "pending_package" || type === "revision_suggested") {
      return { route: "chat", intent: type };
    }

    if (type === "outcome_refresh_due") {
      return { route: "dashboard", intent: "refresh_outcome" };
    }

    return { route: "dashboard", intent: "review_work_item" };
  }
}
