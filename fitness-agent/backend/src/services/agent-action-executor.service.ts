import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { AppStoreService } from "../store/app-store.service";
import { CoachingOutcomeService } from "./coaching-outcome.service";
import { AgentPolicyService } from "./agent-policy.service";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

@Injectable()
export class AgentActionExecutorService {
  constructor(
    private readonly appStore: AppStoreService,
    private readonly outcomeService: CoachingOutcomeService,
    private readonly policyService: AgentPolicyService
  ) {}

  executeSingle(actionType: string, payload: Record<string, unknown>, userId: string) {
    this.policyService.assertActionAllowed(actionType, payload);

    switch (actionType) {
      case "generate_plan":
        return this.appStore.generatePlan(userId, typeof payload.goal === "string" ? payload.goal : "fat_loss");
      case "adjust_plan":
        return this.appStore.adjustPlan(userId, typeof payload.note === "string" ? payload.note : "Adjusted via agent");
      case "create_plan_day":
        return this.appStore.createCurrentPlanDay(
          {
            dayLabel: typeof payload.dayLabel === "string" ? payload.dayLabel : "New day",
            focus: typeof payload.focus === "string" ? payload.focus : "Planned session",
            duration: typeof payload.duration === "string" ? payload.duration : "45 min",
            exercises: normalizeArray(payload.exercises),
            recoveryTip: typeof payload.recoveryTip === "string" ? payload.recoveryTip : "Focus on recovery."
          },
          userId
        );
      case "update_plan_day":
        if (typeof payload.dayId !== "string") {
          throw new ConflictException("The proposal is missing the target day id.");
        }
        return this.appStore.updateCurrentPlanDay(
          payload.dayId,
          {
            dayLabel: typeof payload.dayLabel === "string" ? payload.dayLabel : undefined,
            focus: typeof payload.focus === "string" ? payload.focus : undefined,
            duration: typeof payload.duration === "string" ? payload.duration : undefined,
            exercises: Array.isArray(payload.exercises) ? normalizeArray(payload.exercises) : undefined,
            recoveryTip: typeof payload.recoveryTip === "string" ? payload.recoveryTip : undefined,
            isCompleted: typeof payload.isCompleted === "boolean" ? payload.isCompleted : undefined
          },
          userId
        );
      case "delete_plan_day":
        if (typeof payload.dayId !== "string") {
          throw new ConflictException("The proposal is missing the target day id.");
        }
        return this.appStore.deleteCurrentPlanDay(payload.dayId, userId);
      case "complete_plan_day":
        if (typeof payload.dayId === "string") {
          return this.appStore.updateCurrentPlanDay(payload.dayId, { isCompleted: payload.isCompleted !== false }, userId);
        }
        if (typeof payload.dayLabel === "string") {
          return this.appStore.completeSession(userId, payload.dayLabel);
        }
        throw new ConflictException("The proposal is missing the target day id or label.");
      case "create_body_metric":
        return this.appStore.addBodyMetric({
          userId,
          weightKg: Number(payload.weightKg ?? 0),
          bodyFatPct: payload.bodyFatPct === undefined ? undefined : Number(payload.bodyFatPct),
          waistCm: payload.waistCm === undefined ? undefined : Number(payload.waistCm)
        });
      case "create_daily_checkin":
        return this.appStore.addDailyCheckin({
          userId,
          sleepHours: Number(payload.sleepHours ?? 0),
          waterMl: Number(payload.waterMl ?? 0),
          steps: Number(payload.steps ?? 0),
          energyLevel: typeof payload.energyLevel === "string" ? payload.energyLevel : undefined,
          fatigueLevel: typeof payload.fatigueLevel === "string" ? payload.fatigueLevel : undefined,
          hungerLevel: typeof payload.hungerLevel === "string" ? payload.hungerLevel : undefined
        });
      case "create_workout_log":
        return this.appStore.addWorkoutLog({
          userId,
          workoutType: typeof payload.workoutType === "string" ? payload.workoutType : "general_workout",
          durationMin: Number(payload.durationMin ?? 0),
          intensity: typeof payload.intensity === "string" ? payload.intensity : "moderate",
          exerciseNote: typeof payload.exerciseNote === "string" ? payload.exerciseNote : undefined,
          completion: typeof payload.completion === "string" ? payload.completion : undefined,
          painFeedback: typeof payload.painFeedback === "string" ? payload.painFeedback : undefined,
          fatigueAfter: typeof payload.fatigueAfter === "string" ? payload.fatigueAfter : undefined
        });
      case "generate_next_week_plan":
      case "generate_diet_snapshot":
      case "create_advice_snapshot":
      case "create_coaching_memory":
      case "update_coaching_memory":
      case "archive_coaching_memory":
      case "create_recommendation_feedback":
        return this.executePackageAction(actionType, payload, userId);
      case "refresh_coaching_outcome":
        if (typeof payload.outcomeId !== "string") {
          throw new ConflictException("The proposal is missing the target outcome id.");
        }
        return this.outcomeService.refreshOutcome(payload.outcomeId, userId);
      default:
        throw new ConflictException(`Unsupported action type: ${actionType}`);
    }
  }

  executePackageAction(
    actionType: string,
    payload: Record<string, unknown>,
    userId: string,
    tx?: TransactionClient
  ) {
    this.policyService.assertActionAllowed(actionType, payload, { packageContext: true });

    switch (actionType) {
      case "generate_next_week_plan":
        return this.appStore.generateNextWeekPlan(userId, this.buildGeneratedPlanPayload(payload), tx);
      case "generate_diet_snapshot":
        return this.appStore.createGeneratedDietRecommendation(userId, this.buildGeneratedDietPayload(payload), tx);
      case "create_advice_snapshot":
        return this.appStore.createGeneratedAdviceSnapshot(userId, this.buildGeneratedAdvicePayload(payload), tx);
      case "create_coaching_memory":
        return this.appStore.createCoachingMemory(userId, this.buildCoachingMemoryPayload(payload), tx);
      case "update_coaching_memory":
        if (typeof payload.memoryId !== "string") {
          throw new ConflictException("The proposal is missing the target memory id.");
        }
        return this.appStore.updateCoachingMemory(userId, payload.memoryId, this.buildPartialCoachingMemoryPayload(payload), tx);
      case "archive_coaching_memory":
        if (typeof payload.memoryId !== "string") {
          throw new ConflictException("The proposal is missing the target memory id.");
        }
        return this.appStore.archiveCoachingMemory(userId, payload.memoryId, typeof payload.reason === "string" ? payload.reason : undefined, tx);
      case "create_recommendation_feedback":
        return this.appStore.createRecommendationFeedback(userId, this.buildRecommendationFeedbackPayload(payload), tx);
      default:
        throw new ConflictException(`Action type ${actionType} is not supported inside a transactional coaching package.`);
    }
  }

  private buildGeneratedPlanPayload(payload: Record<string, unknown>) {
    const rawDays = Array.isArray(payload.days) ? payload.days : [];
    return {
      title: typeof payload.title === "string" ? payload.title : "Next week coaching plan",
      goal: typeof payload.goal === "string" ? payload.goal : "maintenance",
      weekOf: typeof payload.weekOf === "string" ? payload.weekOf : undefined,
      days: rawDays.map((day, index) => {
        const item = typeof day === "object" && day ? (day as Record<string, unknown>) : {};
        return {
          dayLabel: typeof item.dayLabel === "string" ? item.dayLabel : `Training day ${index + 1}`,
          focus: typeof item.focus === "string" ? item.focus : "Training focus pending",
          duration: typeof item.duration === "string" ? item.duration : "45 min",
          exercises: normalizeArray(item.exercises),
          recoveryTip: typeof item.recoveryTip === "string" ? item.recoveryTip : "Prioritize recovery quality.",
          isCompleted: false,
          sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : index
        };
      })
    };
  }

  private buildGeneratedDietPayload(payload: Record<string, unknown>) {
    const nutritionRatio = typeof payload.nutritionRatio === "object" && payload.nutritionRatio
      ? (payload.nutritionRatio as Record<string, unknown>)
      : { carbohydrate: 45, protein: 30, fat: 25 };
    const nutritionDetail =
      typeof payload.nutritionDetail === "object" && payload.nutritionDetail
        ? (payload.nutritionDetail as Record<string, unknown>)
        : {};

    return {
      date: typeof payload.date === "string" ? payload.date : undefined,
      userGoal: typeof payload.userGoal === "string" ? payload.userGoal : "maintenance",
      totalCalorie: Number(payload.totalCalorie ?? payload.targetCalorie ?? 2000),
      targetCalorie: Number(payload.targetCalorie ?? payload.totalCalorie ?? 2000),
      nutritionRatio: {
        carbohydrate: Number(nutritionRatio.carbohydrate ?? 45),
        protein: Number(nutritionRatio.protein ?? 30),
        fat: Number(nutritionRatio.fat ?? 25)
      },
      nutritionDetail,
      meals:
        Array.isArray(payload.meals) ? payload.meals.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [],
      agentTips: normalizeArray(payload.agentTips)
    };
  }

  private buildGeneratedAdvicePayload(payload: Record<string, unknown>) {
    return {
      type: typeof payload.type === "string" ? payload.type : "weekly_coaching",
      priority: typeof payload.priority === "string" ? payload.priority : "medium",
      summary: typeof payload.summary === "string" ? payload.summary : "Generated a coaching recommendation from recent data.",
      reasoningTags: normalizeArray(payload.reasoningTags),
      actionItems: normalizeArray(payload.actionItems),
      riskFlags: normalizeArray(payload.riskFlags)
    };
  }

  private buildCoachingMemoryPayload(payload: Record<string, unknown>) {
    const value = typeof payload.value === "object" && payload.value ? (payload.value as Record<string, unknown>) : {};
    return {
      memoryType: typeof payload.memoryType === "string" ? payload.memoryType : "behavior_pattern",
      title: typeof payload.title === "string" ? payload.title : "Coaching memory",
      summary: typeof payload.summary === "string" ? payload.summary : "The user confirmed a long-lived coaching memory.",
      value,
      confidence: Number(payload.confidence ?? 60),
      sourceType: typeof payload.sourceType === "string" ? payload.sourceType : "chat",
      sourceId: typeof payload.sourceId === "string" ? payload.sourceId : undefined,
      reason: typeof payload.reason === "string" ? payload.reason : undefined
    };
  }

  private buildPartialCoachingMemoryPayload(payload: Record<string, unknown>) {
    return {
      memoryType: typeof payload.memoryType === "string" ? payload.memoryType : undefined,
      title: typeof payload.title === "string" ? payload.title : undefined,
      summary: typeof payload.summary === "string" ? payload.summary : undefined,
      value: typeof payload.value === "object" && payload.value ? (payload.value as Record<string, unknown>) : undefined,
      confidence: payload.confidence === undefined ? undefined : Number(payload.confidence),
      sourceType: typeof payload.sourceType === "string" ? payload.sourceType : undefined,
      sourceId: typeof payload.sourceId === "string" ? payload.sourceId : undefined,
      reason: typeof payload.reason === "string" ? payload.reason : undefined
    };
  }

  private buildRecommendationFeedbackPayload(payload: Record<string, unknown>) {
    return {
      reviewSnapshotId: typeof payload.reviewSnapshotId === "string" ? payload.reviewSnapshotId : undefined,
      proposalGroupId: typeof payload.proposalGroupId === "string" ? payload.proposalGroupId : undefined,
      feedbackType: typeof payload.feedbackType === "string" ? payload.feedbackType : "helpful",
      note: typeof payload.note === "string" ? payload.note : undefined
    };
  }
}
