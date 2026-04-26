import { ActivityRings } from "@/components/activity-rings";
import { DashboardCoachingPanel } from "@/components/dashboard-coaching-panel";
import { DietPlateCard } from "@/components/diet-plate-card";
import {
  getBodyMetrics,
  getCoachSummary,
  getCurrentPlan,
  getDashboard,
  getDailyCheckins,
  getTodayDietRecommendation,
  getWorkoutLogs
} from "@/lib/api";
import { requireServerAuthToken } from "@/lib/server-auth";
import type {
  BodyMetricLog,
  CoachSummarySnapshot,
  DashboardSnapshot,
  DailyCheckin,
  DietRecommendationSnapshot,
  WorkoutLog,
  WorkoutPlanDay
} from "@/lib/types";

export const dynamic = "force-dynamic";

const goalLabelByType: Record<string, string> = {
  fat_loss: "Fat loss",
  muscle_gain: "Muscle gain",
  maintenance: "Maintenance"
};

const valueLabelMap: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  moderate: "Moderate",
  high: "High",
  normal: "Normal",
  none: "None"
};

function formatValueLabel(value?: string) {
  if (!value) {
    return "Not logged";
  }

  return valueLabelMap[value] ?? value.replace(/_/g, " ");
}

function formatCompletionRate(value: string) {
  const percent = value.match(/\d+%/)?.[0];
  return percent ? `This week ${percent}` : value;
}

function formatWeightDelta(values: number[]) {
  if (values.length === 0) {
    return "Waiting for more weight logs";
  }

  if (values.length === 1) {
    return `${values[0].toFixed(1)} kg`;
  }

  const delta = values.at(-1)! - values[0];
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg`;
}

function buildFallbackDietRecommendation(): DietRecommendationSnapshot | null {
  return null;
}

function buildFallbackDashboardSnapshot(): DashboardSnapshot {
  return {
    weightTrend: "Weight trend will appear after more check-ins.",
    weeklyCompletionRate: "Weekly completion data is temporarily unavailable.",
    todayFocus: "Keep today simple and rebuild momentum with one small session.",
    recoveryStatus: "Recovery data is temporarily unavailable."
  };
}

function buildFallbackCoachSummary(): CoachSummarySnapshot {
  return {
    currentPlan: {
      plan: null,
      days: []
    },
    completion: {
      completedDays: 0,
      totalDays: 0,
      completionRate: 0
    },
    recentBodyMetrics: [],
    recentDailyCheckins: [],
    recentWorkoutLogs: [],
    latestDietRecommendation: null,
    recentAdviceSnapshots: [],
    pendingCoachingPackage: null,
    needsWeeklyReview: false
  };
}

function buildFallbackPlan(): WorkoutPlanDay[] {
  return [];
}

function buildFallbackBodyMetrics(): BodyMetricLog[] {
  return [];
}

function buildFallbackDailyCheckins(): DailyCheckin[] {
  return [];
}

function buildFallbackWorkoutLogs(): WorkoutLog[] {
  return [];
}

async function resolveSection<T>(loader: Promise<T>, fallback: T) {
  try {
    return {
      data: await loader,
      degraded: false
    };
  } catch {
    return {
      data: fallback,
      degraded: true
    };
  }
}

export default async function DashboardPage() {
  const authToken = requireServerAuthToken();
  const [snapshotResult, planResult, recommendationResult, metricsResult, checkinsResult, workoutsResult, coachSummaryResult] =
    await Promise.all([
      resolveSection(getDashboard(authToken), buildFallbackDashboardSnapshot()),
      resolveSection(getCurrentPlan(authToken), buildFallbackPlan()),
      resolveSection(getTodayDietRecommendation(authToken), buildFallbackDietRecommendation()),
      resolveSection(getBodyMetrics(authToken), buildFallbackBodyMetrics()),
      resolveSection(getDailyCheckins(authToken), buildFallbackDailyCheckins()),
      resolveSection(getWorkoutLogs(authToken), buildFallbackWorkoutLogs()),
      resolveSection(getCoachSummary(authToken), buildFallbackCoachSummary())
    ]);

  const snapshot = snapshotResult.data;
  const plan = planResult.data;
  const recommendation = recommendationResult.data;
  const metrics = metricsResult.data;
  const checkins = checkinsResult.data;
  const workouts = workoutsResult.data;
  const coachSummary = coachSummaryResult.data;

  const isDegraded =
    snapshotResult.degraded ||
    planResult.degraded ||
    recommendationResult.degraded ||
    metricsResult.degraded ||
    checkinsResult.degraded ||
    workoutsResult.degraded ||
    coachSummaryResult.degraded;

  const todayPlan = plan[0];
  const latestMetric = metrics[0];
  const latestCheckin = checkins[0];
  const weeklyWorkouts = workouts.filter((workout) => {
    if (!workout.recordedAt) {
      return false;
    }

    return Date.now() - new Date(workout.recordedAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
  });

  const weeklyDuration = weeklyWorkouts.reduce((sum, workout) => sum + workout.durationMin, 0);
  const recentDurations = [...workouts]
    .slice(0, 7)
    .reverse()
    .map((workout) => Math.max(28, Math.min(100, Math.round((workout.durationMin / 75) * 100))));
  const burnValues = recentDurations.length > 0 ? recentDurations : [36, 48, 58, 44, 62, 54, 68];
  const weightHistory = [...metrics].slice(0, 7).reverse().map((item) => item.weightKg);
  const focusValue = Math.min(
    100,
    Math.round(((weeklyWorkouts.length || 1) / Math.max(plan.length || 1, 1)) * 100)
  );
  const calorieGap = recommendation ? recommendation.targetCalorie - recommendation.totalCalorie : 0;
  const calorieStatus = calorieGap >= 0 ? "Calorie gap" : "Calorie surplus";

  const rings = [
    {
      slug: "move",
      label: "Move",
      value: Math.min(100, Math.round(((latestCheckin?.steps ?? 0) / 10000) * 100)),
      note: latestCheckin
        ? `Today ${latestCheckin.steps.toLocaleString("zh-CN")} / 10,000 steps`
        : "No check-in recorded yet for today.",
      accent: "#d53832"
    },
    {
      slug: "load",
      label: "Load",
      value: Math.min(100, Math.round((weeklyDuration / 180) * 100)),
      note: `Last 7 days ${weeklyDuration} training minutes`,
      accent: "#20202a"
    },
    {
      slug: "focus",
      label: "Focus",
      value: focusValue,
      note: todayPlan?.focus ?? snapshot.todayFocus,
      accent: "#8f9199"
    }
  ];

  const summaryRows = [
    {
      label: "Recovery",
      value: snapshot.recoveryStatus,
      meta: latestCheckin
        ? `Sleep ${latestCheckin.sleepHours} h | Fatigue ${formatValueLabel(latestCheckin.fatigueLevel)}`
        : "Waiting for today's recovery data."
    },
    {
      label: "Nutrition",
      value: recommendation
        ? `${goalLabelByType[recommendation.userGoal] ?? recommendation.userGoal} | ${calorieStatus}`
        : "Today's plate has not been generated yet",
      meta: recommendation
        ? `${recommendation.totalCalorie}/${recommendation.targetCalorie} kcal`
        : "You can still keep the dashboard open while nutrition data catches up."
    },
    {
      label: "Plan",
      value: todayPlan?.focus ?? "No synchronized training plan for today yet",
      meta: todayPlan?.duration ?? "Rest or recovery day"
    }
  ];

  return (
    <div className="page">
      <div className="page-header-compact dashboard-header">
        <div>
          <span className="section-label">Dashboard</span>
          <h2>Today&apos;s overview</h2>
          {isDegraded ? (
            <p className="muted">
              Some live dashboard data is temporarily unavailable. The page is staying usable with fallback values.
            </p>
          ) : null}
        </div>

        <div className="chip-row">
          <span className="mini-chip">{formatCompletionRate(snapshot.weeklyCompletionRate)}</span>
          <span className="status-pill live">
            {latestMetric ? `Latest weight ${latestMetric.weightKg} kg` : "Waiting for more records"}
          </span>
        </div>
      </div>

      <section className="dash-grid dashboard-refined">
        <div className="viz-wrap dashboard-main">
          <ActivityRings rings={rings} />

          <DashboardCoachingPanel coachSummary={coachSummary} />

          {recommendation ? (
            <DietPlateCard recommendation={recommendation} />
          ) : (
            <section className="diet-plate-panel">
              <div className="section-head">
                <div className="section-copy">
                  <span className="section-label">Nutrition</span>
                  <h3>Today&apos;s recommended plate</h3>
                  <p className="muted">
                    Nutrition data is missing right now, so this section stays empty instead of taking down the whole
                    dashboard.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="viz-wrap dashboard-rail">
          <section className="dashboard-summary-panel">
            <div className="section-copy">
              <span className="section-label">Today</span>
              <h3>Key signals</h3>
            </div>

            <div className="dashboard-summary-list">
              {summaryRows.map((item) => (
                <div className="dashboard-summary-row" key={item.label}>
                  <span>{item.label}</span>
                  <div>
                    <strong>{item.value}</strong>
                    <small>{item.meta}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-burn-panel">
            <div className="section-copy">
              <span className="section-label">Trend</span>
              <h3>7-day pace</h3>
            </div>

            <div className="bar-chart compact" aria-hidden="true">
              {burnValues.map((value, index) => (
                <div
                  key={`${value}-${index}`}
                  className={index < 2 ? "bar muted-bar" : "bar"}
                  style={{ height: `${value}%` }}
                />
              ))}
            </div>

            <div className="dashboard-burn-foot">
              <strong>{formatWeightDelta(weightHistory)}</strong>
              <small>
                {todayPlan?.recoveryTip ??
                  latestCheckin?.hungerLevel?.replace(/_/g, " ") ??
                  "Keep logging check-ins and training data to stabilize the next recommendation."}
              </small>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
