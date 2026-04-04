import { ActivityRings } from "@/components/activity-rings";
import { DietPlateCard } from "@/components/diet-plate-card";
import { getCurrentPlan, getDashboard, getTodayDietRecommendation } from "@/lib/api";

const goalLabelByType: Record<string, string> = {
  fat_loss: "减脂",
  muscle_gain: "增肌",
  maintenance: "维持"
};

export default async function DashboardPage() {
  const [snapshot, plan, recommendation] = await Promise.all([
    getDashboard(),
    getCurrentPlan(),
    getTodayDietRecommendation()
  ]);

  const todayPlan = plan[0];
  const rings = [
    { slug: "move", label: "消耗", value: 76, note: "Move · 已消耗 612 kcal", accent: "#d53832" },
    { slug: "load", label: "负荷", value: 64, note: "Load · 已完成 18 组", accent: "#20202a" },
    { slug: "focus", label: "专注", value: 82, note: "Focus · 计划质量 82%", accent: "#8f9199" }
  ];
  const calories = [38, 52, 66, 48, 74, 61, 83];
  const calorieGap = recommendation.targetCalorie - recommendation.totalCalorie;
  const calorieStatus = calorieGap >= 0 ? "热量缺口" : "热量盈余";
  const macroSummary = `${recommendation.nutritionRatio.carbohydrate}% 碳水 · ${recommendation.nutritionRatio.protein}% 蛋白质 · ${recommendation.nutritionRatio.fat}% 脂肪`;

  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">Dashboard</span>
          <h2>今日概览</h2>
        </div>
        <div className="chip-row">
          <span className="status-pill live">饮食建议已同步</span>
          <span className="mini-chip">{snapshot.weeklyCompletionRate}</span>
        </div>
      </div>

      <section className="dash-grid">
        <div className="viz-wrap">
          <ActivityRings rings={rings} />

          <DietPlateCard recommendation={recommendation} />

          <div className="viz-card wide">
            <div className="section-head">
              <div className="section-copy">
                <span className="section-label">Burn</span>
                <h3>7 日消耗</h3>
              </div>
            </div>
            <div className="bar-chart" aria-hidden="true">
              {calories.map((value, index) => (
                <div
                  key={`${value}-${index}`}
                  className={index < 2 ? "bar muted-bar" : "bar"}
                  style={{ height: `${value}%` }}
                />
              ))}
            </div>
            <strong>{snapshot.weightTrend}</strong>
          </div>
        </div>

        <aside className="viz-wrap">
          <div className="dashboard-side-panel">
            <div className="section-copy">
              <span className="section-label">Recovery</span>
              <h3>恢复状态</h3>
              <p className="muted">{snapshot.recoveryStatus}</p>
            </div>
            <div className="quick-stat-row">
              <span className="mini-chip">就绪度 76</span>
              <span className="status-pill live">稳态训练日</span>
            </div>
          </div>

          <div className="dashboard-side-panel dashboard-side-panel-diet">
            <div className="section-copy">
              <span className="section-label">Diet Focus</span>
              <h3>饮食执行重点</h3>
              <p className="muted">
                {recommendation.fitTips ?? "优先保证蛋白质，再根据训练安排分配碳水。"}
              </p>
            </div>
            <div className="quick-stat-row">
              <span className="mini-chip">{goalLabelByType[recommendation.userGoal] ?? recommendation.userGoal}</span>
              <span className="status-pill live">{calorieStatus}</span>
            </div>
            <p className="dashboard-side-note">{macroSummary}</p>
          </div>

          <div className="dashboard-side-panel">
            <div className="section-copy">
              <span className="section-label">Plan</span>
              <h3>{todayPlan?.focus ?? "今日训练待同步"}</h3>
            </div>
            <div className="quick-stat-row">
              <span className="mini-chip">{todayPlan?.duration ?? "Rest day"}</span>
              <span className="status-pill live">今日任务</span>
            </div>
            <p className="muted">{snapshot.todayFocus}</p>
          </div>
        </aside>
      </section>
    </div>
  );
}
