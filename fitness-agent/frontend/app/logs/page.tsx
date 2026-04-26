import { getBodyMetrics, getDailyCheckins, getWorkoutLogs } from "@/lib/api";
import { PageErrorState } from "@/components/page-error-state";
import { requireServerAuthToken } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const valueLabelMap: Record<string, string> = {
  low: "偏低",
  medium: "中等",
  moderate: "适中",
  high: "较高",
  normal: "正常",
  none: "暂无"
};

function formatDate(value?: string) {
  if (!value) {
    return "暂无日期";
  }

  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function formatLevel(value?: string) {
  if (!value) {
    return "未记录";
  }

  return valueLabelMap[value] ?? value.replace(/_/g, " ");
}

function buildWeightTrend(values: number[]) {
  if (values.length === 0) {
    return [48];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values.map((value) => 32 + ((value - min) / range) * 48);
}

function formatWeightDelta(values: number[]) {
  if (values.length === 0) {
    return "暂无体重数据";
  }

  if (values.length === 1) {
    return `${values[0].toFixed(1)} kg`;
  }

  const delta = values.at(-1)! - values[0];
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg`;
}

export default async function LogsPage() {
  const authToken = requireServerAuthToken();
  let metrics;
  let checkins;
  let workouts;

  try {
    [metrics, checkins, workouts] = await Promise.all([
      getBodyMetrics(authToken),
      getDailyCheckins(authToken),
      getWorkoutLogs(authToken)
    ]);
  } catch (error) {
    return <PageErrorState title="每日记录" message={error instanceof Error ? error.message : undefined} />;
  }

  const latestMetric = metrics[0];
  const latestCheckin = checkins[0];
  const latestWorkout = workouts[0];
  const weightHistory = [...metrics].slice(0, 7).reverse();
  const weightTrend = buildWeightTrend(weightHistory.map((item) => item.weightKg));
  const trendLabels = weightHistory.map((item) => formatDate(item.recordedAt));
  const recentLogs = [...checkins].slice(0, 4).map((checkin, index) => ({
    day: formatDate(checkin.recordedAt),
    weight: metrics[index]?.weightKg ?? latestMetric?.weightKg ?? 0,
    sleep: checkin.sleepHours,
    note: `${checkin.steps.toLocaleString("zh-CN")} 步 · 精力 ${formatLevel(checkin.energyLevel)}`
  }));

  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">记录</span>
          <h2>每日记录</h2>
        </div>
        <span className="mini-chip">来自数据库的真实日志</span>
      </div>

      <section className="spotlight-grid">
        <div className="form-panel">
          <div className="section-copy">
            <span className="section-label">身体</span>
            <h2>身体数据</h2>
            <p className="muted">这里展示的是后端返回的 `BodyMetricLog` 真实记录，不再依赖静态示例值。</p>
          </div>

          <div className="form-grid two">
            <label className="field">
              <span className="form-label">体重</span>
              <input value={latestMetric?.weightKg ? `${latestMetric.weightKg} kg` : "暂无数据"} readOnly />
            </label>

            <label className="field">
              <span className="form-label">体脂率</span>
              <input
                value={latestMetric?.bodyFatPct !== undefined ? `${latestMetric.bodyFatPct}%` : "未记录"}
                readOnly
              />
            </label>

            <label className="field span-2">
              <span className="form-label">腰围</span>
              <input value={latestMetric?.waistCm !== undefined ? `${latestMetric.waistCm} cm` : "未记录"} readOnly />
            </label>
          </div>

          <div className="action-row">
            <button className="button" type="button">
              最近更新：{formatDate(latestMetric?.recordedAt)}
            </button>
            <button className="ghost-button" type="button">
              共 {metrics.length} 条
            </button>
          </div>
        </div>

        <aside className="form-panel">
          <div className="section-copy">
            <span className="section-label">状态</span>
            <h2>今日状态</h2>
            <p className="muted">睡眠、步数、饮水和恢复状态都来自数据库中的 `DailyCheckin`。</p>
          </div>

          <div className="form-grid two">
            <label className="field">
              <span className="form-label">睡眠</span>
              <input value={latestCheckin ? `${latestCheckin.sleepHours} h` : "暂无数据"} readOnly />
            </label>

            <label className="field">
              <span className="form-label">步数</span>
              <input value={latestCheckin ? latestCheckin.steps.toLocaleString("zh-CN") : "暂无数据"} readOnly />
            </label>

            <label className="field">
              <span className="form-label">饮水</span>
              <input value={latestCheckin ? `${latestCheckin.waterMl} ml` : "暂无数据"} readOnly />
            </label>

            <label className="field">
              <span className="form-label">精力</span>
              <input value={formatLevel(latestCheckin?.energyLevel)} readOnly />
            </label>
          </div>

          <div className="action-row">
            <button className="button" type="button">
              最近更新：{formatDate(latestCheckin?.recordedAt)}
            </button>
            <span className="field-hint">
              疲劳：{formatLevel(latestCheckin?.fatigueLevel)} · 饥饿：{formatLevel(latestCheckin?.hungerLevel)}
            </span>
          </div>
        </aside>
      </section>

      <section className="log-layout">
        <div className="form-panel">
          <div className="section-copy">
            <span className="section-label">趋势</span>
            <h3>近 7 日体重走势</h3>
          </div>

          <div className="log-trend-bars" aria-hidden="true">
            {weightTrend.map((value, index) => (
              <span key={`${value}-${index}`} className="log-trend-bar" style={{ height: `${value}%` }} />
            ))}
          </div>

          <div className="log-trend-labels" aria-hidden="true">
            {trendLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="log-trend-foot">
            <strong>{formatWeightDelta(weightHistory.map((item) => item.weightKg))}</strong>
            <p className="muted">这条趋势线直接读取最近体重记录，用来替代原本写死在页面里的示例数据。</p>
          </div>
        </div>

        <div className="form-panel">
          <div className="section-copy">
            <span className="section-label">最近</span>
            <h3>最近记录</h3>
          </div>

          <div className="log-sheet">
            {recentLogs.map((entry) => (
              <div className="log-row" key={entry.day}>
                <div className="log-row-head">
                  <span className="metric-label">{entry.day}</span>
                  <strong>{entry.weight.toFixed(1)} kg</strong>
                </div>
                <p className="muted">
                  睡眠 {entry.sleep} h · {entry.note}
                </p>
              </div>
            ))}

            {latestWorkout ? (
              <div className="log-row">
                <div className="log-row-head">
                  <span className="metric-label">最近训练</span>
                  <strong>{latestWorkout.durationMin} 分钟</strong>
                </div>
                <p className="muted">
                  {formatLevel(latestWorkout.workoutType)} · {formatLevel(latestWorkout.intensity)} ·{" "}
                  {formatDate(latestWorkout.recordedAt)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
