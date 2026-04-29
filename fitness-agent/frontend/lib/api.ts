import type {
  AdviceSnapshot,
  AgentCard,
  AgentMessage,
  AgentProposalGroup,
  AgentProductEventSnapshot,
  AgentQualityCheckSnapshot,
  AgentWorkItemSnapshot,
  BodyMetricLog,
  CoachSummarySnapshot,
  CoachingOutcomeSnapshot,
  CoachingReviewSnapshot,
  CurrentPlanSnapshot,
  CreateThreadResponse,
  DashboardSnapshot,
  DailyCheckin,
  DietRecommendationSnapshot,
  ExerciseItem,
  HealthProfile,
  MemorySummarySnapshot,
  ProposalDecisionResponse,
  PostMessageResponse,
  RecommendationFeedbackSnapshot,
  RecommendationFeedbackType,
  RunStepEventPayload,
  StreamEvent,
  ToolEvent,
  UserSnapshot,
  WorkspaceSummarySnapshot,
  WorkoutLog,
  WorkoutPlanDay
} from "@/lib/types";
import type { ExerciseCatalogItem } from "@/lib/exercise-catalog";
import { readAuthAccessToken } from "@/lib/auth";

const backendBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:3001";
const agentBaseUrl = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://127.0.0.1:8000";

interface RawAgentCard {
  type: AgentCard["type"];
  title: string;
  description: string;
  bullets?: string[];
  data?: Record<string, unknown>;
}

interface RawToolEvent {
  event: ToolEvent["event"];
  tool_name: string;
  summary: string;
  payload?: Record<string, unknown>;
  created_at?: string;
}

interface RawPostMessageResponse {
  id: string;
  role: "assistant";
  content: string;
  reasoning_summary: string;
  cards: RawAgentCard[];
  run_id: string;
  tool_events: RawToolEvent[];
  next_actions: string[];
  risk_level: "low" | "medium" | "high";
}

interface RawAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning_summary?: string | null;
  cards?: RawAgentCard[];
  created_at?: string;
}

interface RawProposalDecisionResponse {
  id: string;
  role: "assistant";
  content: string;
  reasoning_summary: string;
  cards: RawAgentCard[];
  proposal_id: string;
  proposal_group_id?: string | null;
  status: string;
}

interface RawCoachingReviewSnapshot {
  id: string;
  thread_id: string;
  run_id?: string | null;
  type: string;
  status: string;
  title: string;
  summary: string;
  adherence_score?: number | null;
  risk_flags?: string[];
  focus_areas?: string[];
  recommendation_tags?: string[];
  input_snapshot?: Record<string, unknown>;
  result_snapshot?: Record<string, unknown>;
  strategy_template_id?: string | null;
  strategy_version?: string | null;
  evidence?: Record<string, unknown> | null;
  uncertainty_flags?: string[];
  created_at: string;
  updated_at: string;
}

interface RawAgentProposalGroup {
  id: string;
  thread_id: string;
  run_id: string;
  review_snapshot_id?: string | null;
  status: string;
  title: string;
  summary: string;
  preview?: Record<string, unknown>;
  risk_level: "low" | "medium" | "high";
  strategy_template_id?: string | null;
  strategy_version?: string | null;
  policy_labels?: string[];
  created_at: string;
  updated_at: string;
}

interface RawAgentWorkItem {
  id: string;
  type: string;
  status: string;
  priority: string;
  source: string;
  title: string;
  summary: string;
  reason: string;
  payload?: Record<string, unknown>;
  request_id?: string | null;
  related_thread_id?: string | null;
  related_review_id?: string | null;
  related_proposal_group_id?: string | null;
  related_outcome_id?: string | null;
  converted_entity_type?: string | null;
  converted_entity_id?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface RawAgentProductEvent {
  id: string;
  event_type: string;
  source: string;
  entity_type?: string | null;
  entity_id?: string | null;
  request_id?: string | null;
  payload?: Record<string, unknown>;
  created_at: string;
}

interface RawAgentQualityCheck {
  id: string;
  user_id: string;
  thread_id?: string | null;
  run_id?: string | null;
  review_snapshot_id?: string | null;
  proposal_group_id?: string | null;
  scope: string;
  status: string;
  score: number;
  blocked_reasons?: string[];
  downgrade_reasons?: string[];
  passed_policy_labels?: string[];
  evidence?: Record<string, unknown>;
  created_at: string;
}

interface RawUserSnapshot {
  id: string;
  name: string;
  email: string;
  profile?: HealthProfile | null;
}

interface RawDatabaseExercise {
  id: string;
  name: string;
  targetMuscles: string[];
  equipment: string;
  level: string;
  steps?: string[];
  commonMistakes?: string[];
  contraindicates?: string[];
  recoveryNotes?: string[];
}

interface RequestOptions {
  authToken?: string;
}

interface RawAdviceSnapshot {
  id: string;
  type: string;
  priority: string;
  summary: string;
  reasoningTags?: string[];
  actionItems?: string[];
  riskFlags?: string[];
  createdAt: string;
}

interface RawCurrentPlanSnapshot {
  plan: CurrentPlanSnapshot["plan"];
  days: WorkoutPlanDay[];
}

type RawMemorySummarySnapshot = MemorySummarySnapshot;

interface RawCoachSummarySnapshot {
  currentPlan: RawCurrentPlanSnapshot;
  completion: {
    completedDays: number;
    totalDays: number;
    completionRate: number;
  };
  recentBodyMetrics: BodyMetricLog[];
  recentDailyCheckins: DailyCheckin[];
  recentWorkoutLogs: WorkoutLog[];
  latestDietRecommendation: DietRecommendationSnapshot | null;
  recentAdviceSnapshots: RawAdviceSnapshot[];
  memorySummary?: RawMemorySummarySnapshot;
  recentOutcomes?: CoachSummarySnapshot["recentOutcomes"];
  recentRecommendationFeedback?: CoachSummarySnapshot["recentRecommendationFeedback"];
  pendingCoachingPackage: {
    id: string;
    threadId: string;
    title: string;
    summary: string;
    status: string;
    preview?: Record<string, unknown>;
    riskLevel?: string;
    strategyTemplateId?: string | null;
    strategyVersion?: string | null;
    policyLabels?: string[];
    createdAt: string;
  } | null;
  needsWeeklyReview: boolean;
}

interface RawWorkspaceSummarySnapshot {
  coachSummary: RawCoachSummarySnapshot;
  memorySummary?: RawMemorySummarySnapshot;
  recentOutcomes?: CoachSummarySnapshot["recentOutcomes"];
  recentFeedback?: CoachSummarySnapshot["recentRecommendationFeedback"];
  pendingPackage?: RawCoachSummarySnapshot["pendingCoachingPackage"];
  pendingWorkItems?: RawAgentWorkItem[];
  latestQualityChecks?: RawAgentQualityCheck[];
  latestProductEvents?: RawAgentProductEvent[];
  todayPlan?: WorkoutPlanDay | null;
  logGapSummary?: WorkspaceSummarySnapshot["logGapSummary"];
  recommendedEntryPoints?: WorkspaceSummarySnapshot["recommendedEntryPoints"];
}

function resolveAuthToken(authToken?: string) {
  if (authToken) {
    return authToken;
  }

  return readAuthAccessToken() ?? undefined;
}

function buildHeaders(headers?: HeadersInit, authToken?: string) {
  const mergedHeaders = new Headers(headers);

  if (authToken) {
    mergedHeaders.set("Authorization", authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`);
  }

  return mergedHeaders;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit, options?: RequestOptions): Promise<T> {
  let response: Response;
  const authToken = resolveAuthToken(options?.authToken);

  try {
    response = await fetch(input, {
      ...init,
      cache: "no-store",
      headers: buildHeaders(init?.headers, authToken)
    });
  } catch (error) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
    const serviceLabel = url.startsWith(agentBaseUrl) ? "agent service" : "backend API";
    const serviceUrl = url.startsWith(agentBaseUrl) ? agentBaseUrl : backendBaseUrl;
    const reason = error instanceof Error ? error.message : "unknown network error";

    throw new Error(
      `Unable to reach the ${serviceLabel} at ${serviceUrl}. Start that service and try again. Original error: ${reason}`
    );
  }

  if (!response.ok) {
    let detail = "";

    try {
      const rawText = await response.text();
      if (!rawText) {
        detail = "";
      } else {
        try {
          const parsed = JSON.parse(rawText) as { message?: string | string[] };
          detail = Array.isArray(parsed.message) ? parsed.message.join("; ") : parsed.message ?? rawText;
        } catch {
          detail = rawText;
        }
      }
    } catch {
      detail = "";
    }

    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

function mapCard(card: RawAgentCard): AgentCard {
  return {
    type: card.type,
    title: card.title,
    description: card.description,
    bullets: card.bullets ?? [],
    data: card.data ?? {}
  };
}

function mapToolEvent(event: RawToolEvent): ToolEvent {
  return {
    event: event.event,
    tool_name: event.tool_name,
    summary: event.summary,
    payload: event.payload,
    created_at: event.created_at
  };
}

function mapPostMessageResponse(response: RawPostMessageResponse): PostMessageResponse {
  return {
    id: response.id,
    role: response.role,
    content: response.content,
    reasoningSummary: response.reasoning_summary,
    cards: (response.cards ?? []).map(mapCard),
    runId: response.run_id,
    toolEvents: (response.tool_events ?? []).map(mapToolEvent),
    nextActions: response.next_actions ?? [],
    riskLevel: response.risk_level
  };
}

function mapAgentMessage(message: RawAgentMessage): AgentMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    reasoningSummary: message.reasoning_summary ?? undefined,
    cards: (message.cards ?? []).map(mapCard)
  };
}

function mapProposalDecisionResponse(response: RawProposalDecisionResponse): ProposalDecisionResponse {
  return {
    id: response.id,
    role: response.role,
    content: response.content,
    reasoningSummary: response.reasoning_summary,
    cards: (response.cards ?? []).map(mapCard),
    proposalId: response.proposal_id,
    proposalGroupId: response.proposal_group_id ?? null,
    status: response.status
  };
}

function mapCoachingReview(review: RawCoachingReviewSnapshot): CoachingReviewSnapshot {
  return {
    id: review.id,
    threadId: review.thread_id,
    runId: review.run_id ?? null,
    type: review.type,
    status: review.status,
    title: review.title,
    summary: review.summary,
    adherenceScore: review.adherence_score ?? null,
    riskFlags: review.risk_flags ?? [],
    focusAreas: review.focus_areas ?? [],
    recommendationTags: review.recommendation_tags ?? [],
    inputSnapshot: review.input_snapshot ?? {},
    resultSnapshot: review.result_snapshot ?? {},
    strategyTemplateId: review.strategy_template_id ?? null,
    strategyVersion: review.strategy_version ?? null,
    evidence: review.evidence ?? null,
    uncertaintyFlags: review.uncertainty_flags ?? [],
    createdAt: review.created_at,
    updatedAt: review.updated_at
  };
}

function mapProposalGroup(group: RawAgentProposalGroup): AgentProposalGroup {
  return {
    id: group.id,
    threadId: group.thread_id,
    runId: group.run_id,
    reviewSnapshotId: group.review_snapshot_id ?? null,
    status: group.status,
    title: group.title,
    summary: group.summary,
    preview: group.preview ?? {},
    riskLevel: group.risk_level,
    strategyTemplateId: group.strategy_template_id ?? null,
    strategyVersion: group.strategy_version ?? null,
    policyLabels: group.policy_labels ?? [],
    createdAt: group.created_at,
    updatedAt: group.updated_at
  };
}

function mapAgentWorkItem(item: RawAgentWorkItem): AgentWorkItemSnapshot {
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    priority: item.priority,
    source: item.source,
    title: item.title,
    summary: item.summary,
    reason: item.reason,
    payload: item.payload ?? {},
    requestId: item.request_id ?? null,
    relatedThreadId: item.related_thread_id ?? null,
    relatedReviewId: item.related_review_id ?? null,
    relatedProposalGroupId: item.related_proposal_group_id ?? null,
    relatedOutcomeId: item.related_outcome_id ?? null,
    convertedEntityType: item.converted_entity_type ?? null,
    convertedEntityId: item.converted_entity_id ?? null,
    expiresAt: item.expires_at ?? null,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function mapAgentProductEvent(event: RawAgentProductEvent): AgentProductEventSnapshot {
  return {
    id: event.id,
    eventType: event.event_type,
    source: event.source,
    entityType: event.entity_type ?? null,
    entityId: event.entity_id ?? null,
    requestId: event.request_id ?? null,
    payload: event.payload ?? {},
    createdAt: event.created_at
  };
}

function mapAgentQualityCheck(check: RawAgentQualityCheck): AgentQualityCheckSnapshot {
  return {
    id: check.id,
    userId: check.user_id,
    threadId: check.thread_id ?? null,
    runId: check.run_id ?? null,
    reviewSnapshotId: check.review_snapshot_id ?? null,
    proposalGroupId: check.proposal_group_id ?? null,
    scope: check.scope,
    status: check.status,
    score: check.score,
    blockedReasons: check.blocked_reasons ?? [],
    downgradeReasons: check.downgrade_reasons ?? [],
    passedPolicyLabels: check.passed_policy_labels ?? [],
    evidence: check.evidence ?? {},
    createdAt: check.created_at
  };
}

function mapAdviceSnapshot(snapshot: RawAdviceSnapshot): AdviceSnapshot {
  return {
    id: snapshot.id,
    type: snapshot.type,
    priority: snapshot.priority,
    summary: snapshot.summary,
    reasoningTags: snapshot.reasoningTags ?? [],
    actionItems: snapshot.actionItems ?? [],
    riskFlags: snapshot.riskFlags ?? [],
    createdAt: snapshot.createdAt
  };
}

function mapCurrentPlanSnapshot(snapshot: RawCurrentPlanSnapshot): CurrentPlanSnapshot {
  return {
    plan: snapshot.plan ?? null,
    days: snapshot.days ?? []
  };
}

function buildEmptyMemorySummary(): MemorySummarySnapshot {
  return {
    activeMemories: [],
    recentEvents: [],
    confidenceSummary: {
      high: 0,
      medium: 0,
      low: 0
    },
    safetyConstraints: []
  };
}

function mapCoachSummary(snapshot: RawCoachSummarySnapshot): CoachSummarySnapshot {
  return {
    currentPlan: mapCurrentPlanSnapshot(snapshot.currentPlan),
    completion: snapshot.completion,
    recentBodyMetrics: snapshot.recentBodyMetrics ?? [],
    recentDailyCheckins: snapshot.recentDailyCheckins ?? [],
    recentWorkoutLogs: snapshot.recentWorkoutLogs ?? [],
    latestDietRecommendation: snapshot.latestDietRecommendation ?? null,
    recentAdviceSnapshots: (snapshot.recentAdviceSnapshots ?? []).map(mapAdviceSnapshot),
    memorySummary: snapshot.memorySummary ?? buildEmptyMemorySummary(),
    recentOutcomes: snapshot.recentOutcomes ?? [],
    recentRecommendationFeedback: snapshot.recentRecommendationFeedback ?? [],
    pendingCoachingPackage: snapshot.pendingCoachingPackage,
    needsWeeklyReview: Boolean(snapshot.needsWeeklyReview)
  };
}

function mapWorkspaceSummary(snapshot: RawWorkspaceSummarySnapshot): WorkspaceSummarySnapshot {
  const coachSummary = mapCoachSummary(snapshot.coachSummary);
  return {
    coachSummary,
    memorySummary: snapshot.memorySummary ?? coachSummary.memorySummary,
    recentOutcomes: snapshot.recentOutcomes ?? coachSummary.recentOutcomes,
    recentFeedback: snapshot.recentFeedback ?? coachSummary.recentRecommendationFeedback,
    pendingPackage: snapshot.pendingPackage ?? coachSummary.pendingCoachingPackage,
    pendingWorkItems: (snapshot.pendingWorkItems ?? []).map(mapAgentWorkItem),
    latestQualityChecks: (snapshot.latestQualityChecks ?? []).map(mapAgentQualityCheck),
    latestProductEvents: (snapshot.latestProductEvents ?? []).map(mapAgentProductEvent),
    todayPlan: snapshot.todayPlan ?? null,
    logGapSummary: snapshot.logGapSummary ?? {
      latestCheckinAt: null,
      latestWorkoutAt: null,
      needsCheckin: false,
      needsWorkoutLog: false
    },
    recommendedEntryPoints: snapshot.recommendedEntryPoints ?? []
  };
}

function mapUserSnapshot(user: RawUserSnapshot): UserSnapshot {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    profile: user.profile ?? null
  };
}

function sanitizeEquipmentKey(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "other";
}

function derivePrimaryGroup(targetMuscles: string[]) {
  const joined = targetMuscles.join(" ").toLowerCase();

  if (joined.includes("cardio")) return "Cardio";
  if (
    joined.includes("quad") ||
    joined.includes("glute") ||
    joined.includes("hamstring") ||
    joined.includes("calf")
  ) {
    return "Legs";
  }
  if (joined.includes("core") || joined.includes("ab")) return "Core";
  if (joined.includes("lat") || joined.includes("back") || joined.includes("trap")) return "Back";
  if (joined.includes("chest") || joined.includes("pec")) return "Chest";
  if (joined.includes("shoulder") || joined.includes("delt")) return "Shoulders";
  if (joined.includes("bicep") || joined.includes("tricep") || joined.includes("forearm")) return "Arms";
  return "Full body";
}

function deriveSecondaryGroup(targetMuscles: string[]) {
  const first = targetMuscles[0];
  if (!first) {
    return "General";
  }

  return first
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapDatabaseExercise(item: RawDatabaseExercise): ExerciseCatalogItem {
  const primaryGroup = derivePrimaryGroup(item.targetMuscles ?? []);
  const secondaryGroup = deriveSecondaryGroup(item.targetMuscles ?? []);
  const category = primaryGroup === "Cardio" ? "Cardio" : "Strength";
  const mechanic = (item.targetMuscles?.length ?? 0) > 1 ? "Compound" : "Isolation";
  const notes = [...(item.commonMistakes ?? []), ...(item.contraindicates ?? []), ...(item.recoveryNotes ?? [])];

  return {
    id: item.id,
    name: item.name,
    primaryGroup,
    secondaryGroup,
    targetMuscles: item.targetMuscles ?? [],
    equipment: item.equipment,
    equipmentKey: sanitizeEquipmentKey(item.equipment),
    level: item.level,
    summary: `${category} exercise for ${item.targetMuscles.join(", ")}.`,
    prescription:
      category === "Cardio"
        ? "20-40 min"
        : mechanic === "Compound"
          ? "3-5 sets x 6-10 reps"
          : "3-4 sets x 10-15 reps",
    cues: item.steps ?? [],
    notes: notes.length > 0 ? notes : ["No additional notes yet."],
    category,
    mechanic,
    force: null,
    searchText: [item.name, primaryGroup, secondaryGroup, item.equipment, item.level, ...(item.targetMuscles ?? [])]
      .join(" ")
      .toLowerCase()
  };
}

export async function getMe(authToken?: string): Promise<UserSnapshot> {
  const user = await requestJson<RawUserSnapshot>(`${backendBaseUrl}/me`, undefined, { authToken });
  return mapUserSnapshot(user);
}

export async function getBodyMetrics(authToken?: string): Promise<BodyMetricLog[]> {
  return requestJson<BodyMetricLog[]>(`${backendBaseUrl}/logs/body-metrics`, undefined, { authToken });
}

export async function getDailyCheckins(authToken?: string): Promise<DailyCheckin[]> {
  return requestJson<DailyCheckin[]>(`${backendBaseUrl}/logs/daily-checkins`, undefined, { authToken });
}

export async function getWorkoutLogs(authToken?: string): Promise<WorkoutLog[]> {
  return requestJson<WorkoutLog[]>(`${backendBaseUrl}/logs/workouts`, undefined, { authToken });
}

export async function getDashboard(authToken?: string): Promise<DashboardSnapshot> {
  return requestJson<DashboardSnapshot>(`${backendBaseUrl}/dashboard`, undefined, { authToken });
}

export async function getCurrentPlan(authToken?: string): Promise<WorkoutPlanDay[]> {
  return requestJson<WorkoutPlanDay[]>(`${backendBaseUrl}/plans/current`, undefined, { authToken });
}

export async function getCoachSummary(authToken?: string): Promise<CoachSummarySnapshot> {
  const snapshot = await requestJson<RawCoachSummarySnapshot>(`${backendBaseUrl}/agent/context/coach-summary`, undefined, {
    authToken
  });
  return mapCoachSummary(snapshot);
}

export async function getWorkspaceSummary(authToken?: string): Promise<WorkspaceSummarySnapshot> {
  const snapshot = await requestJson<RawWorkspaceSummarySnapshot>(
    `${backendBaseUrl}/agent/context/workspace-summary`,
    undefined,
    { authToken }
  );
  return mapWorkspaceSummary(snapshot);
}

export async function getAgentWorkItems(authToken?: string): Promise<AgentWorkItemSnapshot[]> {
  const items = await requestJson<RawAgentWorkItem[]>(`${backendBaseUrl}/agent/work-items`, undefined, { authToken });
  return items.map(mapAgentWorkItem);
}

export async function refreshAgentWorkItems(): Promise<{
  requestId: string;
  created: AgentWorkItemSnapshot[];
  updated: AgentWorkItemSnapshot[];
  skipped: Array<{ type: string; reason: string }>;
  expired: Array<{ id: string; type: string; previous_status: string }>;
  pending: AgentWorkItemSnapshot[];
}> {
  const result = await requestJson<{
    requestId: string;
    created: RawAgentWorkItem[];
    updated: RawAgentWorkItem[];
    skipped: Array<{ type: string; reason: string }>;
    expired: Array<{ id: string; type: string; previous_status: string }>;
    pending: RawAgentWorkItem[];
  }>(`${backendBaseUrl}/agent/work-items/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "dashboard_refresh" })
  });

  return {
    requestId: result.requestId,
    created: result.created.map(mapAgentWorkItem),
    updated: result.updated.map(mapAgentWorkItem),
    skipped: result.skipped,
    expired: result.expired,
    pending: result.pending.map(mapAgentWorkItem)
  };
}

export async function openAgentWorkItem(workItemId: string): Promise<{
  workItem: AgentWorkItemSnapshot;
  navigation: { route: string; intent: string };
}> {
  const result = await requestJson<{
    workItem: RawAgentWorkItem;
    navigation: { route: string; intent: string };
  }>(`${backendBaseUrl}/agent/work-items/${workItemId}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  return {
    workItem: mapAgentWorkItem(result.workItem),
    navigation: result.navigation
  };
}

export async function dismissAgentWorkItem(workItemId: string, reason?: string): Promise<AgentWorkItemSnapshot> {
  const result = await requestJson<RawAgentWorkItem>(`${backendBaseUrl}/agent/work-items/${workItemId}/dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
  return mapAgentWorkItem(result);
}

export async function getQualityChecksForRun(runId: string, authToken?: string): Promise<AgentQualityCheckSnapshot[]> {
  const checks = await requestJson<RawAgentQualityCheck[]>(`${backendBaseUrl}/agent/quality/runs/${runId}`, undefined, {
    authToken
  });
  return checks.map(mapAgentQualityCheck);
}

export async function getQualityChecksForProposalGroup(
  proposalGroupId: string,
  authToken?: string
): Promise<AgentQualityCheckSnapshot[]> {
  const checks = await requestJson<RawAgentQualityCheck[]>(
    `${backendBaseUrl}/agent/quality/proposal-groups/${proposalGroupId}`,
    undefined,
    { authToken }
  );
  return checks.map(mapAgentQualityCheck);
}

type PlanDayPayload = {
  dayLabel: string;
  focus: string;
  duration: string;
  exercises: string[];
  recoveryTip: string;
};

type UpdatePlanDayPayload = Partial<PlanDayPayload> & {
  isCompleted?: boolean;
};

export async function createCurrentPlanDay(payload: PlanDayPayload, authToken?: string): Promise<WorkoutPlanDay> {
  return requestJson<WorkoutPlanDay>(`${backendBaseUrl}/plans/current/day`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, { authToken });
}

export async function updateCurrentPlanDay(
  dayId: string,
  payload: UpdatePlanDayPayload,
  authToken?: string
): Promise<WorkoutPlanDay> {
  return requestJson<WorkoutPlanDay>(`${backendBaseUrl}/plans/current/day/${dayId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, { authToken });
}

export async function deleteCurrentPlanDay(dayId: string, authToken?: string): Promise<{ ok: boolean; id: string }> {
  return requestJson<{ ok: boolean; id: string }>(`${backendBaseUrl}/plans/current/day/${dayId}`, {
    method: "DELETE"
  }, { authToken });
}

export async function getTodayDietRecommendation(authToken?: string): Promise<DietRecommendationSnapshot> {
  return requestJson<DietRecommendationSnapshot>(`${backendBaseUrl}/diet-recommendation/today`, undefined, {
    authToken
  });
}

export async function getExercises(): Promise<ExerciseItem[]> {
  return getExerciseCatalog();
}

export async function getExerciseCatalog(): Promise<ExerciseCatalogItem[]> {
  const items = await requestJson<RawDatabaseExercise[]>(`${backendBaseUrl}/exercises`);
  return items.map(mapDatabaseExercise);
}

export async function createThread(): Promise<CreateThreadResponse> {
  const result = await requestJson<{ thread_id: string }>(`${agentBaseUrl}/agent/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  return { threadId: result.thread_id };
}

export async function getThreadMessages(threadId: string): Promise<AgentMessage[]> {
  const result = await requestJson<RawAgentMessage[]>(`${agentBaseUrl}/agent/threads/${threadId}/messages`);
  return result.map(mapAgentMessage);
}

export async function postMessage(threadId: string, text: string): Promise<PostMessageResponse> {
  const result = await requestJson<RawPostMessageResponse>(`${agentBaseUrl}/agent/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  return mapPostMessageResponse(result);
}

export async function approveProposal(proposalId: string): Promise<ProposalDecisionResponse> {
  const result = await requestJson<RawProposalDecisionResponse>(`${agentBaseUrl}/agent/proposals/${proposalId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return mapProposalDecisionResponse(result);
}

export async function rejectProposal(proposalId: string): Promise<ProposalDecisionResponse> {
  const result = await requestJson<RawProposalDecisionResponse>(`${agentBaseUrl}/agent/proposals/${proposalId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  return mapProposalDecisionResponse(result);
}

export async function approveProposalGroup(proposalGroupId: string): Promise<ProposalDecisionResponse> {
  const result = await requestJson<RawProposalDecisionResponse>(
    `${agentBaseUrl}/agent/proposal-groups/${proposalGroupId}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  return mapProposalDecisionResponse(result);
}

export async function rejectProposalGroup(proposalGroupId: string): Promise<ProposalDecisionResponse> {
  const result = await requestJson<RawProposalDecisionResponse>(
    `${agentBaseUrl}/agent/proposal-groups/${proposalGroupId}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  return mapProposalDecisionResponse(result);
}

export async function submitRecommendationFeedback(payload: {
  reviewSnapshotId?: string | null;
  proposalGroupId?: string | null;
  feedbackType: RecommendationFeedbackType;
  note?: string | null;
}): Promise<RecommendationFeedbackSnapshot> {
  return requestJson<RecommendationFeedbackSnapshot>(`${agentBaseUrl}/agent/feedback/recommendation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      review_snapshot_id: payload.reviewSnapshotId ?? null,
      proposal_group_id: payload.proposalGroupId ?? null,
      feedback_type: payload.feedbackType,
      note: payload.note ?? null
    })
  });
}

export async function getThreadProposalGroups(threadId: string): Promise<AgentProposalGroup[]> {
  const result = await requestJson<RawAgentProposalGroup[]>(`${backendBaseUrl}/agent/state/threads/${threadId}/proposal-groups`);
  return result.map(mapProposalGroup);
}

export async function getThreadCoachingReviews(threadId: string): Promise<CoachingReviewSnapshot[]> {
  const result = await requestJson<RawCoachingReviewSnapshot[]>(`${backendBaseUrl}/agent/state/threads/${threadId}/reviews`);
  return result.map(mapCoachingReview);
}

export async function getThreadCoachingOutcomes(threadId: string): Promise<CoachingOutcomeSnapshot[]> {
  return requestJson<CoachingOutcomeSnapshot[]>(`${backendBaseUrl}/agent/state/threads/${threadId}/outcomes`);
}

export async function refreshDueCoachingOutcomes(): Promise<{
  refreshedCount: number;
  outcomes: CoachingOutcomeSnapshot[];
}> {
  return requestJson<{ refreshedCount: number; outcomes: CoachingOutcomeSnapshot[] }>(
    `${backendBaseUrl}/agent/state/outcomes/refresh-due`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
}

export async function refreshCoachingOutcome(outcomeId: string): Promise<CoachingOutcomeSnapshot> {
  return requestJson<CoachingOutcomeSnapshot>(`${backendBaseUrl}/agent/state/outcomes/${outcomeId}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
}

export async function streamRun(
  runId: string,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const authToken = resolveAuthToken();
  const response = await fetch(`${agentBaseUrl}/agent/runs/${runId}/stream`, {
    method: "GET",
    cache: "no-store",
    headers: buildHeaders(undefined, authToken)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawFinalMessage = false;

  const processChunk = (chunk: string) => {
    const lines = chunk.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLine = lines.find((line) => line.startsWith("data:"));

    if (!eventLine || !dataLine) {
      return;
    }

    const event = eventLine.slice(6).trim() as StreamEvent["event"];
    const data = JSON.parse(dataLine.slice(5).trim()) as RunStepEventPayload;
    onEvent({ event, data });

    if (event === "final_message") {
      sawFinalMessage = true;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      processChunk(chunk);

      if (sawFinalMessage) {
        await reader.cancel();
        return;
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    processChunk(trailing);
  }
}
