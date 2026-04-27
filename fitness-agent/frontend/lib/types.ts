export type CardType =
  | "health_advice_card"
  | "workout_plan_card"
  | "exercise_card"
  | "recovery_card"
  | "place_result_card"
  | "reasoning_summary_card"
  | "tool_activity_card"
  | "action_proposal_card"
  | "action_result_card"
  | "weekly_review_card"
  | "daily_guidance_card"
  | "coaching_package_card";

export type RunStepType =
  | "thinking_summary"
  | "tool_call_started"
  | "tool_call_completed"
  | "card_render"
  | "final_message";

export interface AgentCard {
  type: CardType;
  title: string;
  description: string;
  bullets?: string[];
  data?: Record<string, unknown>;
}

export interface ToolEvent {
  event: "tool_call_started" | "tool_call_completed";
  tool_name: string;
  summary: string;
  payload?: Record<string, unknown>;
  created_at?: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningSummary?: string;
  cards?: AgentCard[];
}

export interface ProposalDecisionResponse {
  id: string;
  role: "assistant";
  content: string;
  reasoningSummary: string;
  cards: AgentCard[];
  proposalId: string;
  proposalGroupId?: string | null;
  status: string;
}

export interface CoachingReviewSnapshot {
  id: string;
  threadId: string;
  runId?: string | null;
  type: string;
  status: string;
  title: string;
  summary: string;
  adherenceScore?: number | null;
  riskFlags: string[];
  focusAreas: string[];
  recommendationTags: string[];
  inputSnapshot: Record<string, unknown>;
  resultSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProposalGroup {
  id: string;
  threadId: string;
  runId: string;
  reviewSnapshotId?: string | null;
  status: string;
  title: string;
  summary: string;
  preview: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
}

export interface AdviceSnapshot {
  id: string;
  type: string;
  priority: string;
  summary: string;
  reasoningTags: string[];
  actionItems: string[];
  riskFlags: string[];
  createdAt: string;
}

export interface MemorySummarySnapshot {
  activeMemories: Array<{
    id: string;
    memoryType: string;
    title: string;
    summary: string;
    value: Record<string, unknown>;
    confidence: number;
    sourceType: string;
    sourceId?: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    memoryId?: string | null;
    eventType: string;
    reason: string;
    sourceType: string;
    sourceId?: string | null;
    createdAt: string;
  }>;
  confidenceSummary: {
    high: number;
    medium: number;
    low: number;
  };
  safetyConstraints: string[];
}

export interface CoachingOutcomeSnapshot {
  id: string;
  reviewSnapshotId?: string | null;
  proposalGroupId?: string | null;
  strategyTemplateId?: string | null;
  strategyVersion?: string | null;
  status: string;
  measurementStart: string;
  measurementEnd: string;
  baseline: Record<string, unknown>;
  observed: Record<string, unknown>;
  score?: number | null;
  signals: Record<string, unknown>;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface CurrentPlanSnapshot {
  plan: {
    id: string;
    title: string;
    goal: string;
    status: string;
    version: number;
    weekOf: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  days: WorkoutPlanDay[];
}

export interface CoachSummarySnapshot {
  currentPlan: CurrentPlanSnapshot;
  completion: {
    completedDays: number;
    totalDays: number;
    completionRate: number;
  };
  recentBodyMetrics: BodyMetricLog[];
  recentDailyCheckins: DailyCheckin[];
  recentWorkoutLogs: WorkoutLog[];
  latestDietRecommendation: DietRecommendationSnapshot | null;
  recentAdviceSnapshots: AdviceSnapshot[];
  memorySummary: MemorySummarySnapshot;
  recentOutcomes: CoachingOutcomeSnapshot[];
  pendingCoachingPackage: {
    id: string;
    threadId: string;
    title: string;
    summary: string;
    status: string;
    createdAt: string;
  } | null;
  needsWeeklyReview: boolean;
}

export interface CreateThreadResponse {
  threadId: string;
}

export interface PostMessageResponse {
  id: string;
  role: "assistant";
  content: string;
  reasoningSummary: string;
  cards: AgentCard[];
  runId: string;
  toolEvents: ToolEvent[];
  nextActions: string[];
  riskLevel: "low" | "medium" | "high";
}

export interface RunStepEventPayload {
  id: string;
  step_type: RunStepType;
  title: string;
  payload: Record<string, unknown>;
  created_at?: string;
}

export interface StreamEvent {
  event: RunStepType;
  data: RunStepEventPayload;
}

export interface DashboardSnapshot {
  weightTrend: string;
  weeklyCompletionRate: string;
  todayFocus: string;
  recoveryStatus: string;
}

export interface HealthProfile {
  age?: number;
  gender?: string;
  heightCm?: number;
  currentWeightKg?: number;
  targetWeightKg?: number;
  activityLevel?: string;
  trainingExperience?: string;
  trainingDaysPerWeek?: number;
  equipmentAccess?: string;
  limitations?: string;
}

export interface UserSnapshot {
  id: string;
  name: string;
  email: string;
  profile: HealthProfile | null;
}

export interface BodyMetricLog {
  id?: string;
  weightKg: number;
  bodyFatPct?: number;
  waistCm?: number;
  recordedAt?: string;
}

export interface DailyCheckin {
  id?: string;
  sleepHours: number;
  waterMl: number;
  steps: number;
  energyLevel?: string;
  fatigueLevel?: string;
  hungerLevel?: string;
  recordedAt?: string;
}

export interface WorkoutLog {
  id?: string;
  workoutType: string;
  durationMin: number;
  intensity: string;
  exerciseNote?: string;
  completion?: string;
  painFeedback?: string;
  fatigueAfter?: string;
  recordedAt?: string;
}

export interface WorkoutPlanDay {
  id: string;
  dayLabel: string;
  focus: string;
  duration: string;
  exercises: string[];
  recoveryTip: string;
  isCompleted: boolean;
  sortOrder: number;
}

export interface ExerciseItem {
  id: string;
  name: string;
  primaryGroup?: string;
  secondaryGroup?: string;
  targetMuscles: string[];
  equipment: string;
  equipmentKey?: string;
  level: string;
  summary?: string;
  prescription?: string;
  cues?: string[];
  notes: string[];
}

export interface MacroTarget {
  target: number;
  recommend: number;
  remaining: number;
}

export interface DietFoodNutrition {
  protein: number;
  carbohydrate: number;
  fat: number;
  fiber?: number;
}

export interface DietFoodReplacement {
  name: string;
  weight: number;
  calorie: number;
  cooking: string;
  nutrition: DietFoodNutrition;
}

export interface DietFood {
  name: string;
  weight: number;
  calorie: number;
  cooking: string;
  nutrition: DietFoodNutrition;
  replaceable: DietFoodReplacement[];
}

export type DietMealType = "breakfast" | "lunch" | "dinner";

export interface DietMeal {
  mealType: DietMealType;
  totalCalorie: number;
  foods: DietFood[];
}

export interface DietRecommendationSnapshot {
  id: string;
  date: string;
  userGoal: string;
  totalCalorie: number;
  targetCalorie: number;
  nutritionRatio: {
    carbohydrate: number;
    protein: number;
    fat: number;
  };
  nutritionDetail: {
    protein: MacroTarget;
    carbohydrate: MacroTarget;
    fat: MacroTarget;
    fiber: MacroTarget;
  };
  meals: DietMeal[];
  agentTips: string[];
  remark?: string;
  fitTips?: string;
}
