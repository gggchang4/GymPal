import { ExerciseLibrarySearch } from "@/components/exercise-library-search";
import { ManualContextPanel } from "@/components/manual-context-panel";
import { PageErrorState } from "@/components/page-error-state";
import { getCurrentPlan, getExerciseCatalog } from "@/lib/api";
import { requireServerAuthToken } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ExercisesPage() {
  const authToken = requireServerAuthToken();
  let plan;
  let exerciseCatalog;

  try {
    [plan, exerciseCatalog] = await Promise.all([getCurrentPlan(authToken), getExerciseCatalog()]);
  } catch (error) {
    return <PageErrorState title="动作库" message={error instanceof Error ? error.message : undefined} />;
  }
  const todayFocus = plan[0]?.focus ?? "上肢力量与核心";

  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">动作库</span>
          <h2>动作库</h2>
        </div>
        <span className="mini-chip">先筛选，再看细节</span>
      </div>

      <ManualContextPanel
        sourcePage="exercises"
        title="补充动作偏好"
        description="手动记录喜欢或不适合的动作、器械条件、动作替代方案。保存后 agent 生成计划时可以参考。"
        defaultCategory="exercise_context"
        placeholder="例如：不喜欢杠铃深蹲，可以用腿举替代；引体向上需要弹力带辅助。"
      />

      <ExerciseLibrarySearch catalog={exerciseCatalog} todayFocus={todayFocus} />
    </div>
  );
}
