export type CardType =
  | "health_advice_card"
  | "workout_plan_card"
  | "exercise_card"
  | "recovery_card"
  | "place_result_card"
  | "reasoning_summary_card"
  | "tool_activity_card";

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

export interface WorkoutPlanDay {
  dayLabel: string;
  focus: string;
  duration: string;
  exercises: string[];
  recoveryTip: string;
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
