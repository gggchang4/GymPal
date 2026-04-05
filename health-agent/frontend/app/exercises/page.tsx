import { ExerciseLibrary } from "@/components/exercise-library";
import { getCurrentPlan } from "@/lib/api";

export default async function ExercisesPage() {
  const plan = await getCurrentPlan();
  const todayFocus = plan[0]?.focus ?? "上肢力量与核心";

  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">Library</span>
          <h2>动作库</h2>
        </div>
        <span className="mini-chip">按部位与器材筛选</span>
      </div>

      <ExerciseLibrary todayFocus={todayFocus} />
    </div>
  );
}
