import { ActivityRings } from "@/components/activity-rings";
import { CoachWorkspacePanel } from "@/components/coach-workspace-panel";
import { DietPlateCard } from "@/components/diet-plate-card";
import { getCurrentPlan, getDashboard, getTodayDietRecommendation, getWorkspaceSummary } from "@/lib/api";
import { requireServerAuthToken } from "@/lib/server-auth";
import type { DashboardSnapshot, DietRecommendationSnapshot, WorkspaceSummarySnapshot, WorkoutPlanDay } from "@/lib/types";

export const dynamic = "force-dynamic";

const goalLabelByType: Record<string, string> = {
  fat_loss: "减脂",
  muscle_gain: "增肌",
  maintenance: "维持"
};

const staticDietRecommendation: DietRecommendationSnapshot = {
  id: "static-dashboard-plate",
  date: "2026-04-27",
  userGoal: "fat_loss",
  totalCalorie: 1940,
  targetCalorie: 2100,
  nutritionRatio: { carbohydrate: 42, protein: 34, fat: 24 },
  nutritionDetail: {
    protein: { target: 145, recommend: 141, remaining: 4 },
    carbohydrate: { target: 210, recommend: 188, remaining: 22 },
    fat: { target: 60, recommend: 52, remaining: 8 },
    fiber: { target: 28, recommend: 26, remaining: 2 }
  },
  meals: [
    {
      mealType: "breakfast",
      totalCalorie: 460,
      foods: [
        {
          name: "Greek yogurt bowl",
          weight: 320,
          calorie: 260,
          cooking: "cold prep",
          nutrition: { protein: 24, carbohydrate: 32, fat: 6, fiber: 5 },
          replaceable: [
            {
              name: "soy yogurt bowl",
              weight: 300,
              calorie: 240,
              cooking: "cold prep",
              nutrition: { protein: 20, carbohydrate: 30, fat: 7, fiber: 6 }
            }
          ]
        },
        {
          name: "oats",
          weight: 55,
          calorie: 200,
          cooking: "boiled",
          nutrition: { protein: 8, carbohydrate: 28, fat: 5, fiber: 4 },
          replaceable: []
        }
      ]
    },
    {
      mealType: "lunch",
      totalCalorie: 690,
      foods: [
        {
          name: "chicken breast",
          weight: 160,
          calorie: 260,
          cooking: "pan seared",
          nutrition: { protein: 42, carbohydrate: 0, fat: 8, fiber: 0 },
          replaceable: []
        },
        {
          name: "brown rice",
          weight: 180,
          calorie: 220,
          cooking: "steamed",
          nutrition: { protein: 5, carbohydrate: 46, fat: 2, fiber: 3 },
          replaceable: []
        },
        {
          name: "broccoli",
          weight: 180,
          calorie: 160,
          cooking: "steamed",
          nutrition: { protein: 10, carbohydrate: 18, fat: 2, fiber: 7 },
          replaceable: []
        }
      ]
    },
    {
      mealType: "dinner",
      totalCalorie: 790,
      foods: [
        {
          name: "salmon",
          weight: 150,
          calorie: 300,
          cooking: "oven baked",
          nutrition: { protein: 34, carbohydrate: 0, fat: 18, fiber: 0 },
          replaceable: []
        },
        {
          name: "quinoa",
          weight: 160,
          calorie: 190,
          cooking: "boiled",
          nutrition: { protein: 7, carbohydrate: 33, fat: 3, fiber: 4 },
          replaceable: []
        },
        {
          name: "mixed greens",
          weight: 170,
          calorie: 120,
          cooking: "olive oil toss",
          nutrition: { protein: 5, carbohydrate: 14, fat: 4, fiber: 7 },
          replaceable: []
        },
        {
          name: "olive oil",
          weight: 14,
          calorie: 180,
          cooking: "dressing",
          nutrition: { protein: 0, carbohydrate: 0, fat: 20, fiber: 0 },
          replaceable: []
        }
      ]
    }
  ],
  agentTips: [
    "把午餐作为体积最大的餐次，下午饱腹感会更稳。",
    "三餐平均铺开蛋白质，训练恢复会更容易跟上。",
    "如果夜间饥饿感上升，先增加蔬菜，再增加主食。"
  ],
  remark: "静态餐盘用于 dashboard 降级展示，后续可直接替换为接口返回数据。",
  fitTips: "保持高蛋白、适量碳水和稳定蔬菜摄入。"
};

function buildFallbackDashboardSnapshot(): DashboardSnapshot {
  return {
    weightTrend: "体重趋势等待更多记录",
    weeklyCompletionRate: "本周完成率 76%",
    todayFocus: "今天保持一次低摩擦训练，优先稳定执行。",
    recoveryStatus: "恢复状态稳定"
  };
}

function buildFallbackPlan(): WorkoutPlanDay[] {
  return [
    {
      id: "static-dashboard-plan",
      dayLabel: "Today",
      focus: "全身稳定训练",
      duration: "45 分钟",
      exercises: ["Goblet squat 4x10", "Seated row 4x10", "Push-up 3x12"],
      recoveryTip: "每组保留 1-2 次余力，避免额外疲劳。",
      isCompleted: false,
      sortOrder: 0
    }
  ];
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
  const [snapshotResult, planResult, recommendationResult, workspaceResult] = await Promise.all([
    resolveSection(getDashboard(authToken), buildFallbackDashboardSnapshot()),
    resolveSection(getCurrentPlan(authToken), buildFallbackPlan()),
    resolveSection(getTodayDietRecommendation(authToken), staticDietRecommendation),
    resolveSection<WorkspaceSummarySnapshot | null>(getWorkspaceSummary(authToken), null)
  ]);

  const snapshot = snapshotResult.data;
  const plan = planResult.data;
  const recommendation = recommendationResult.data;
  const workspace = workspaceResult.data;
  const isDegraded = snapshotResult.degraded || planResult.degraded || recommendationResult.degraded || workspaceResult.degraded;
  const todayPlan = plan[0];
  const rings = [
    { slug: "move", label: "消耗", value: 76, note: "今日已消耗 612 kcal", accent: "#d53832" },
    { slug: "load", label: "负荷", value: 64, note: "已完成 18 组训练", accent: "#20202a" },
    { slug: "focus", label: "专注", value: 82, note: "计划执行质量 82%", accent: "#8f9199" }
  ];
  const burnValues = [38, 52, 66, 48, 74, 61, 83];
  const calorieGap = recommendation.targetCalorie - recommendation.totalCalorie;
  const calorieStatus = calorieGap >= 0 ? "热量缺口" : "热量盈余";

  const summaryRows = [
    {
      label: "恢复",
      value: snapshot.recoveryStatus,
      meta: "准备度 76"
    },
    {
      label: "饮食",
      value: `${goalLabelByType[recommendation.userGoal] ?? recommendation.userGoal} · ${calorieStatus}`,
      meta: `${recommendation.totalCalorie}/${recommendation.targetCalorie} kcal`
    },
    {
      label: "计划",
      value: todayPlan?.focus ?? "今日训练待同步",
      meta: todayPlan?.duration ?? "休息日"
    }
  ];

  return (
    <div className="page">
      <div className="page-header-compact dashboard-header">
        <div>
          <span className="section-label">Dashboard</span>
          <h2>今日总览</h2>
          {isDegraded ? (
            <p className="muted">部分实时数据暂时不可用，当前页面已使用静态兜底数据保持可用。</p>
          ) : null}
        </div>
        <div className="chip-row">
          <span className="mini-chip">{snapshot.weeklyCompletionRate}</span>
          <span className={`status-pill ${isDegraded ? "idle" : "live"}`}>
            {isDegraded ? "静态兜底" : "已同步"}
          </span>
        </div>
      </div>

      {workspace ? <CoachWorkspacePanel workspace={workspace} /> : null}

      <section className="dash-grid dashboard-refined">
        <div className="viz-wrap dashboard-main">
          <ActivityRings rings={rings} />
          <DietPlateCard recommendation={recommendation} />
        </div>

        <aside className="viz-wrap dashboard-rail">
          <section className="dashboard-summary-panel">
            <div className="section-copy">
              <span className="section-label">Today</span>
              <h3>关键状态</h3>
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
              <span className="section-label">Burn</span>
              <h3>7 日趋势</h3>
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
              <strong>{snapshot.weightTrend}</strong>
              <small>{snapshot.todayFocus}</small>
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
