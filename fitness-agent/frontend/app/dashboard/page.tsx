import { DashboardActivityRings } from "@/components/dashboard-activity-rings";
import { DashboardDietPlateManager } from "@/components/dashboard-diet-plate-manager";
import {
  getBodyMetrics,
  getMe,
  getTodayDietRecommendation,
  getWorkoutLogs
} from "@/lib/api";
import { requireServerAuthToken } from "@/lib/server-auth";
import type { BodyMetricLog, WorkoutLog } from "@/lib/types";

export const dynamic = "force-dynamic";

async function resolveOptional<T>(loader: Promise<T>): Promise<T | null> {
  try {
    return await loader;
  } catch {
    return null;
  }
}

function buildTrendValues(metrics: BodyMetricLog[], workouts: WorkoutLog[], currentProfileWeight?: number) {
  const weightValues = [...metrics]
    .slice(0, 7)
    .reverse()
    .map((item) => item.weightKg);

  if (typeof currentProfileWeight === "number" && Number.isFinite(currentProfileWeight) && currentProfileWeight > 0) {
    if (weightValues.length === 0) {
      weightValues.push(currentProfileWeight);
    } else {
      weightValues[weightValues.length - 1] = currentProfileWeight;
    }
  }

  if (weightValues.length > 0) {
    const min = Math.min(...weightValues);
    const max = Math.max(...weightValues);
    const range = max - min || 1;
    return weightValues.map((value) => Math.max(12, Math.round(24 + ((value - min) / range) * 62)));
  }

  return [...workouts]
    .slice(0, 7)
    .reverse()
    .map((item) => Math.max(12, Math.min(86, item.durationMin)));
}

export default async function DashboardPage() {
  const authToken = requireServerAuthToken();
  const [recommendation, metricsResult, workoutsResult, meResult] = await Promise.all([
    resolveOptional(getTodayDietRecommendation(authToken)),
    resolveOptional(getBodyMetrics(authToken)),
    resolveOptional(getWorkoutLogs(authToken)),
    resolveOptional(getMe(authToken))
  ]);

  const metrics = metricsResult ?? [];
  const workouts = workoutsResult ?? [];
  const currentProfileWeight = meResult?.profile?.currentWeightKg;
  const hasWeightTrend = metrics.length > 0 || (typeof currentProfileWeight === "number" && currentProfileWeight > 0);
  const trendValues = buildTrendValues(metrics, workouts, currentProfileWeight);
  const trendSource = hasWeightTrend ? "最近体重变化" : workouts.length > 0 ? "最近训练时长" : "暂无趋势数据";

  return (
    <div className="page dashboard-stack">
      <div className="page-header-compact dashboard-header">
        <div>
          <span className="section-label">仪表盘</span>
          <h2>今日总览</h2>
        </div>
      </div>

      <DashboardActivityRings />

      <DashboardDietPlateManager recommendation={recommendation} />

      <section className="dashboard-burn-panel">
        <div className="section-copy">
          <span className="section-label">趋势</span>
          <h3>7 日趋势</h3>
        </div>

        {trendValues.length > 0 ? (
          <div className="bar-chart compact" aria-hidden="true">
            {trendValues.map((value, index) => (
              <div key={`${value}-${index}`} className="bar" style={{ height: `${value}%` }} />
            ))}
          </div>
        ) : (
          <p className="muted">暂无最近 7 日数据。添加身体记录或训练记录后，这里会自动生成趋势。</p>
        )}

        <div className="dashboard-burn-foot">
          <strong>{trendSource}</strong>
          <small>数据来自数据库中的真实记录。</small>
        </div>
      </section>
    </div>
  );
}
