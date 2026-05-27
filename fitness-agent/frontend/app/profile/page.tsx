import Image from "next/image";
import { PageErrorState } from "@/components/page-error-state";
import { getBodyMetrics, getCurrentPlan, getMe, getWorkoutLogs } from "@/lib/api";
import { requireServerAuthToken } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const valueLabelMap: Record<string, string> = {
  male: "男",
  female: "女",
  other: "其他",
  low: "偏低",
  medium: "中等",
  moderate: "适中",
  high: "较高",
  normal: "正常",
  novice: "新手",
  intermediate: "进阶",
  advanced: "高级",
  commercial_gym: "商业健身房",
  home_gym: "家庭器械",
  bodyweight_only: "徒手训练"
};

function formatDate(value?: string) {
  if (!value) {
    return "暂无日期";
  }

  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function formatLabel(value?: string) {
  if (!value) {
    return "未记录";
  }

  return valueLabelMap[value] ?? value.replace(/_/g, " ");
}

function buildSparklinePath(points: number[], width: number, height: number) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function WeightSparkline({ points }: { points: number[] }) {
  const width = 420;
  const height = 120;
  const path = buildSparklinePath(points, width, height);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  return (
    <svg viewBox={`0 0 ${width} ${height + 12}`} className="profile-sparkline" aria-hidden="true">
      <path d={path} className="profile-sparkline-path" />
      {points.map((point, index) => {
        const cx = (index / Math.max(points.length - 1, 1)) * width;
        const cy = height - ((point - min) / range) * height;

        return (
          <circle
            key={`${point}-${index}`}
            cx={cx}
            cy={cy}
            r={index === points.length - 1 ? 4.5 : 3}
            className="profile-sparkline-dot"
          />
        );
      })}
    </svg>
  );
}

export default async function ProfilePage() {
  const authToken = requireServerAuthToken();
  let me;
  let metrics;
  let workouts;
  let plan;

  try {
    [me, metrics, workouts, plan] = await Promise.all([
      getMe(authToken),
      getBodyMetrics(authToken),
      getWorkoutLogs(authToken),
      getCurrentPlan(authToken)
    ]);
  } catch (error) {
    return <PageErrorState title="个人档案" message={error instanceof Error ? error.message : undefined} />;
  }

  const profile = me.profile;
  const latestMetric = metrics[0];
  const currentWeight = latestMetric?.weightKg ?? profile?.currentWeightKg ?? 0;
  const targetWeight = profile?.targetWeightKg ?? currentWeight;
  const heightCm = profile?.heightCm ?? 0;
  const bmi = heightCm > 0 ? currentWeight / ((heightCm / 100) * (heightCm / 100)) : 0;
  const weightTrend = [...metrics].slice(0, 8).reverse();
  const weightPoints =
    weightTrend.length > 0 ? weightTrend.map((item) => item.weightKg) : [currentWeight || 0, currentWeight || 0];

  const weeklyWorkoutCount = workouts.filter((workout) => {
    if (!workout.recordedAt) {
      return false;
    }

    return Date.now() - new Date(workout.recordedAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  const trainingTarget = profile?.trainingDaysPerWeek ?? 4;
  const latestWorkout = workouts[0];
  const memberRows = [
    ["邮箱", me.email],
    ["身高", heightCm > 0 ? `${heightCm} cm` : "未记录"],
    ["当前体重", currentWeight > 0 ? `${currentWeight} kg` : "未记录"],
    ["目标体重", targetWeight > 0 ? `${targetWeight} kg` : "未记录"],
    ["BMI", bmi > 0 ? bmi.toFixed(1) : "未记录"],
    ["训练经验", formatLabel(profile?.trainingExperience)],
    ["器械条件", formatLabel(profile?.equipmentAccess)]
  ] as const;

  const recentStats = [
    {
      label: "身体记录总数",
      value: String(metrics.length),
      note: latestMetric ? `最近更新：${formatDate(latestMetric.recordedAt)}` : "还没有身体数据"
    },
    {
      label: "近 7 日训练频次",
      value: `${weeklyWorkoutCount} / ${trainingTarget}`,
      note: "基于真实 WorkoutLog 计算，不再使用静态卡片数据"
    },
    {
      label: "当前计划天数",
      value: String(plan.length),
      note: plan[0]?.focus ? `下一次重点：${plan[0].focus}` : "还没有激活中的训练计划"
    }
  ] as const;

  const trainingFrequency = [
    { label: "本周训练", sessions: weeklyWorkoutCount, target: trainingTarget },
    { label: "身体记录", sessions: Math.min(metrics.length, 7), target: 7 },
    { label: "计划安排", sessions: plan.length, target: Math.max(trainingTarget, 1) }
  ] as const;

  const recentNotes = [
    profile?.limitations ? `限制说明：${profile.limitations}` : null,
    latestWorkout?.painFeedback ? `训练反馈：${latestWorkout.painFeedback}` : null,
    plan[0]?.recoveryTip ? `计划提示：${plan[0].recoveryTip}` : null,
    latestWorkout?.exerciseNote ? `最近训练备注：${latestWorkout.exerciseNote}` : null
  ].filter((note): note is string => Boolean(note));

  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">档案</span>
          <h2>个人档案</h2>
        </div>
        <span className="mini-chip">每周 {trainingTarget} 练 · 已接入数据库</span>
      </div>

      <div className="profile-layout">
        <aside className="profile-sidebar">
          <section className="profile-member-card">
            <div className="profile-member-top">
              <Image
                src="/brand/gympal-logo.jpg"
                alt="GymPal"
                width={96}
                height={96}
                className="profile-member-avatar"
              />

              <div className="profile-member-copy">
                <span className="section-label">Member</span>
                <h3>{me.name}</h3>
                <p className="profile-member-note">
                  邮箱 {me.email}。这个档案页会把用户信息、健康档案、身体记录、训练日志和当前计划汇总到同一处。
                </p>
              </div>
            </div>

            <div className="profile-member-highlight">
              <div>
                <span className="profile-stat-label">当前体重</span>
                <strong>{currentWeight > 0 ? `${currentWeight} kg` : "未记录"}</strong>
              </div>
              <div>
                <span className="profile-stat-label">目标体重</span>
                <strong>{targetWeight > 0 ? `${targetWeight} kg` : "未记录"}</strong>
              </div>
            </div>

            <div className="profile-member-grid">
              {memberRows.map(([label, value]) => (
                <div className="profile-member-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <div className="profile-member-tags">
              <span className="profile-ledger-tag">{formatLabel(profile?.activityLevel)}</span>
              <span className="profile-ledger-tag">每周 {trainingTarget} 次</span>
              <span className="profile-ledger-tag">{formatLabel(profile?.gender)}</span>
            </div>
          </section>
        </aside>

        <div className="profile-content">
          <section className="profile-recent-grid">
            {recentStats.map((item) => (
              <article className="profile-recent-card" key={item.label}>
                <span className="section-label">近期</span>
                <strong>{item.value}</strong>
                <p>{item.label}</p>
                <small>{item.note}</small>
              </article>
            ))}
          </section>

          <section className="profile-data-section">
            <div className="profile-data-head">
              <div>
                <span className="section-label">体重</span>
                <h3>近期体重变化</h3>
              </div>
              <p className="muted">使用数据库中的真实体重记录生成趋势线，更适合观察中期节奏，而不是单日波动。</p>
            </div>

            <div className="profile-trend-panel">
              <div className="profile-trend-chart">
                <WeightSparkline points={weightPoints} />
                <div className="profile-trend-labels" aria-hidden="true">
                  {weightTrend.map((item) => (
                    <span key={`${item.recordedAt}-${item.weightKg}`}>{formatDate(item.recordedAt)}</span>
                  ))}
                </div>
              </div>

              <div className="profile-trend-summary">
                <strong>
                  {weightPoints[0].toFixed(1)} → {weightPoints.at(-1)!.toFixed(1)} kg
                </strong>
                <p className="muted">
                  {weightTrend.length > 1
                    ? `跟踪周期内变化 ${(weightPoints.at(-1)! - weightPoints[0]).toFixed(1)} kg。`
                    : "继续补充身体记录后，这里的趋势会更有参考价值。"}
                </p>

                <div className="profile-mini-metrics">
                  <div>
                    <span className="profile-stat-label">最新腰围</span>
                    <strong>{latestMetric?.waistCm !== undefined ? `${latestMetric.waistCm} cm` : "未记录"}</strong>
                  </div>
                  <div>
                    <span className="profile-stat-label">当前 BMI</span>
                    <strong>{bmi > 0 ? bmi.toFixed(1) : "未记录"}</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="profile-data-section">
            <div className="profile-data-head">
              <div>
                <span className="section-label">训练</span>
                <h3>训练频次记录</h3>
              </div>
              <p className="muted">把近一周训练次数与目标频次并排展示，更容易看出执行是否稳定。</p>
            </div>

            <div className="profile-frequency-list">
              {trainingFrequency.map((item) => (
                <div className="profile-frequency-row" key={item.label}>
                  <div className="profile-frequency-copy">
                    <span>{item.label}</span>
                    <strong>
                      {item.sessions} / {item.target}
                    </strong>
                  </div>
                  <div className="profile-frequency-rail" aria-hidden="true">
                    <span style={{ width: `${Math.min((item.sessions / Math.max(item.target, 1)) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="profile-data-section">
            <div className="profile-data-head">
              <div>
                <span className="section-label">观察</span>
                <h3>近期观察</h3>
              </div>
            </div>

            <div className="profile-note-stream">
              {(recentNotes.length > 0
                ? recentNotes
                : ["继续补充训练与恢复记录，系统会生成更完整的阶段观察。"]).map((note, index) => (
                <div className="profile-note-row" key={`${index}-${note}`}>
                  <span className="profile-rule-index">{String(index + 1).padStart(2, "0")}</span>
                  <p>{note}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
