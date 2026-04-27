import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type DbClient = Prisma.TransactionClient | PrismaClient | PrismaService;
type CoachingOutcomeEntity = Awaited<ReturnType<PrismaService["coachingOutcome"]["findMany"]>>[number];
type ProposalGroupOutcomeSource = Prisma.AgentProposalGroupGetPayload<{
  include: {
    reviewSnapshot: true;
  };
}>;

const OUTCOME_MEASUREMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_FOLLOW_UP_SIGNAL_COUNT = 2;

export interface CoachingOutcomeRecord {
  id: string;
  reviewSnapshotId: string | null;
  proposalGroupId: string | null;
  strategyTemplateId: string | null;
  strategyVersion: string | null;
  status: string;
  measurementStart: string;
  measurementEnd: string;
  baseline: Prisma.JsonValue;
  observed: Prisma.JsonValue;
  score: number | null;
  signals: Prisma.JsonValue;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function average(values: number[]) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return null;
  }

  return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function normalizeSignalText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function hasMeaningfulPainSignal(value: string | null | undefined) {
  const normalized = normalizeSignalText(value);
  if (!normalized) {
    return false;
  }

  if (
    ["none", "no", "n/a", "na", "无", "没有", "暂无"].includes(normalized) ||
    ["no pain", "none today", "no discomfort", "无疼痛", "没有疼痛", "无不适"].some((token) => normalized.includes(token))
  ) {
    return false;
  }

  return true;
}

function isCompletedWorkout(value: string | null | undefined) {
  const normalized = normalizeSignalText(value);
  return ["complete", "completed", "done", "finished", "yes", "完成", "已完成"].some((token) =>
    normalized.includes(token)
  );
}

function isHighFatigue(value: string | null | undefined) {
  const normalized = normalizeSignalText(value);
  return ["high", "very_high", "severe", "exhausted", "heavy", "高疲劳", "很累", "非常累"].some((token) =>
    normalized.includes(token)
  );
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

@Injectable()
export class CoachingOutcomeService {
  constructor(private readonly prisma: PrismaService) {}

  private db(client?: DbClient) {
    return client ?? this.prisma;
  }

  mapOutcome(outcome: CoachingOutcomeEntity): CoachingOutcomeRecord {
    return {
      id: outcome.id,
      reviewSnapshotId: outcome.reviewSnapshotId,
      proposalGroupId: outcome.proposalGroupId,
      strategyTemplateId: outcome.strategyTemplateId,
      strategyVersion: outcome.strategyVersion,
      status: outcome.status,
      measurementStart: outcome.measurementStart.toISOString(),
      measurementEnd: outcome.measurementEnd.toISOString(),
      baseline: outcome.baseline,
      observed: outcome.observed,
      score: outcome.score,
      signals: outcome.signals,
      summary: outcome.summary,
      createdAt: outcome.createdAt.toISOString(),
      updatedAt: outcome.updatedAt.toISOString()
    };
  }

  buildInitialOutcomePayload({
    proposalGroup,
    actionCount,
    executedAt
  }: {
    proposalGroup: ProposalGroupOutcomeSource;
    actionCount: number;
    executedAt: Date;
  }) {
    const review = proposalGroup.reviewSnapshot;
    const measurementEnd = new Date(executedAt.getTime() + OUTCOME_MEASUREMENT_WINDOW_MS);
    const inputSnapshot = typeof review?.inputSnapshot === "object" && review.inputSnapshot ? review.inputSnapshot : {};
    const resultSnapshot = typeof review?.resultSnapshot === "object" && review.resultSnapshot ? review.resultSnapshot : {};

    return {
      userId: proposalGroup.userId,
      reviewSnapshotId: proposalGroup.reviewSnapshotId,
      proposalGroupId: proposalGroup.id,
      status: "pending",
      measurementStart: executedAt,
      measurementEnd,
      baseline: asJson({
        reviewType: review?.type ?? null,
        reviewTitle: review?.title ?? null,
        adherenceScore: review?.adherenceScore ?? null,
        riskFlags: review?.riskFlags ?? [],
        focusAreas: review?.focusAreas ?? [],
        recommendationTags: review?.recommendationTags ?? [],
        inputSnapshot,
        resultSnapshot,
        packagePreview: proposalGroup.preview
      }),
      observed: asJson({}),
      signals: asJson({
        source: "coaching_package_execution",
        actionCount,
        createdFromStatus: "executed"
      }),
      summary: "Pending outcome measurement. Add workout logs, daily check-ins, or body metrics to evaluate this package."
    };
  }

  async createPendingOutcomeForExecutedPackage(
    client: DbClient,
    input: {
      proposalGroup: ProposalGroupOutcomeSource;
      actionCount: number;
      executedAt: Date;
    }
  ) {
    return this.db(client).coachingOutcome.upsert({
      where: { proposalGroupId: input.proposalGroup.id },
      update: {},
      create: this.buildInitialOutcomePayload(input)
    });
  }

  async getOutcomeForProposalGroup(proposalGroupId: string) {
    return this.prisma.coachingOutcome.findUnique({
      where: { proposalGroupId }
    });
  }

  async listThreadOutcomes(threadId: string, userId: string, take = 20) {
    const thread = await this.prisma.agentThread.findFirst({
      where: {
        id: threadId,
        userId
      },
      select: { id: true }
    });

    if (!thread) {
      throw new NotFoundException("Agent thread not found.");
    }

    const outcomes = await this.prisma.coachingOutcome.findMany({
      where: {
        userId,
        OR: [
          { proposalGroup: { threadId } },
          { reviewSnapshot: { threadId } }
        ]
      },
      orderBy: { updatedAt: "desc" },
      take
    });

    return outcomes.map((outcome) => this.mapOutcome(outcome));
  }

  async getRecentOutcomesForUser(userId: string, take = 3): Promise<CoachingOutcomeRecord[]> {
    const outcomes = await this.prisma.coachingOutcome.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take
    });

    return outcomes.map((outcome) => this.mapOutcome(outcome));
  }

  async refreshDueOutcomesForUser(userId: string, now = new Date(), take = 20) {
    const outcomes = await this.prisma.coachingOutcome.findMany({
      where: {
        userId,
        status: "pending",
        measurementEnd: { lte: now }
      },
      orderBy: { measurementEnd: "asc" },
      take
    });

    const refreshed: CoachingOutcomeRecord[] = [];
    for (const outcome of outcomes) {
      refreshed.push(await this.refreshOutcome(outcome.id, userId, now));
    }

    return {
      refreshedCount: refreshed.length,
      outcomes: refreshed
    };
  }

  async refreshOutcome(outcomeId: string, userId: string, now = new Date()) {
    const outcome = await this.prisma.coachingOutcome.findFirst({
      where: { id: outcomeId, userId }
    });

    if (!outcome) {
      throw new NotFoundException("Coaching outcome not found.");
    }

    if (outcome.status !== "pending" || outcome.measurementEnd.getTime() > now.getTime()) {
      return this.mapOutcome(outcome);
    }

    const [workouts, checkins, metrics] = await Promise.all([
      this.prisma.workoutLog.findMany({
        where: {
          userId,
          recordedAt: { gte: outcome.measurementStart, lte: outcome.measurementEnd }
        },
        orderBy: { recordedAt: "asc" }
      }),
      this.prisma.dailyCheckin.findMany({
        where: {
          userId,
          recordedAt: { gte: outcome.measurementStart, lte: outcome.measurementEnd }
        },
        orderBy: { recordedAt: "asc" }
      }),
      this.prisma.bodyMetricLog.findMany({
        where: {
          userId,
          recordedAt: { gte: outcome.measurementStart, lte: outcome.measurementEnd }
        },
        orderBy: { recordedAt: "asc" }
      })
    ]);

    const evaluated = this.evaluateSignals({ workouts, checkins, metrics });
    const updatedCount = await this.prisma.coachingOutcome.updateMany({
      where: {
        id: outcome.id,
        userId,
        status: "pending",
        measurementEnd: { lte: now }
      },
      data: {
        status: evaluated.status,
        observed: asJson(evaluated.observed),
        score: evaluated.score,
        signals: asJson({
          ...evaluated.signals,
          evaluatedAt: now.toISOString()
        }),
        summary: evaluated.summary
      }
    });

    if (updatedCount.count !== 1) {
      const latest = await this.prisma.coachingOutcome.findFirst({
        where: { id: outcome.id, userId }
      });

      if (!latest) {
        throw new NotFoundException("Coaching outcome not found.");
      }

      return this.mapOutcome(latest);
    }

    const updated = await this.prisma.coachingOutcome.findUniqueOrThrow({
      where: { id: outcome.id }
    });

    return this.mapOutcome(updated);
  }

  private evaluateSignals({
    workouts,
    checkins,
    metrics
  }: {
    workouts: Array<{
      completion: string | null;
      painFeedback: string | null;
      durationMin: number;
      fatigueAfter: string | null;
    }>;
    checkins: Array<{
      sleepHours: number;
      steps: number;
      fatigueLevel: string | null;
    }>;
    metrics: Array<{
      weightKg: number;
    }>;
  }) {
    const completedWorkoutCount = workouts.filter((workout) => isCompletedWorkout(workout.completion)).length;
    const painSignalCount = workouts.filter((workout) => hasMeaningfulPainSignal(workout.painFeedback)).length;
    const highFatigueCount =
      workouts.filter((workout) => isHighFatigue(workout.fatigueAfter)).length +
      checkins.filter((checkin) => isHighFatigue(checkin.fatigueLevel)).length;
    const averageSleepHours = average(checkins.map((checkin) => checkin.sleepHours));
    const averageSteps = average(checkins.map((checkin) => checkin.steps));
    const totalWorkoutMinutes = workouts.reduce((total, workout) => total + Math.max(0, workout.durationMin), 0);
    const followUpSignalCount = workouts.length + checkins.length + metrics.length;
    const weightDeltaKg =
      metrics.length >= 2 ? Number((metrics[metrics.length - 1].weightKg - metrics[0].weightKg).toFixed(2)) : null;

    const observed = {
      workoutLogCount: workouts.length,
      completedWorkoutCount,
      totalWorkoutMinutes,
      dailyCheckinCount: checkins.length,
      bodyMetricCount: metrics.length,
      averageSleepHours: averageSleepHours === null ? null : Number(averageSleepHours.toFixed(1)),
      averageSteps: averageSteps === null ? null : Math.round(averageSteps),
      painSignalCount,
      highFatigueCount,
      weightDeltaKg
    };

    if (followUpSignalCount < MIN_FOLLOW_UP_SIGNAL_COUNT) {
      return {
        status: "inconclusive",
        score: null,
        observed,
        signals: {
          source: "rule_based_outcome_evaluation",
          followUpSignalCount,
          minimumRequiredSignals: MIN_FOLLOW_UP_SIGNAL_COUNT,
          reason: "insufficient_follow_up_data"
        },
        summary: "Outcome inconclusive: there is not enough follow-up data in the measurement window."
      };
    }

    let score = 50;
    score += Math.min(workouts.length * 8, 24);
    score += Math.min(completedWorkoutCount * 8, 16);
    score += Math.min(checkins.length * 3, 15);

    if (averageSleepHours !== null && averageSleepHours >= 7) {
      score += 10;
    } else if (averageSleepHours !== null && averageSleepHours < 6) {
      score -= 10;
    }

    if (painSignalCount > 0) {
      score -= 15;
    }

    if (highFatigueCount > 0) {
      score -= 10;
    }

    const normalizedScore = clampScore(score);
    const status = normalizedScore >= 70 ? "positive" : normalizedScore >= 45 ? "mixed" : "negative";
    const summary =
      status === "positive"
        ? "Outcome positive: follow-up logs suggest the package was actionable and recovery remained manageable."
        : status === "mixed"
          ? "Outcome mixed: follow-up data shows some useful execution signals, but recovery or consistency needs attention."
          : "Outcome negative: follow-up data suggests the package may have been too hard, poorly timed, or not well matched.";

    return {
      status,
      score: normalizedScore,
      observed,
      signals: {
        source: "rule_based_outcome_evaluation",
        followUpSignalCount,
        painSignalCount,
        highFatigueCount
      },
      summary
    };
  }
}
