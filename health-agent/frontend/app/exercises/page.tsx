import exerciseCatalogData from "@/data/exercise-catalog.generated.json";
import { ExerciseLibrarySearch } from "@/components/exercise-library-search";
import { getCurrentPlan } from "@/lib/api";
import type { ExerciseCatalogItem } from "@/lib/exercise-catalog";

export default async function ExercisesPage() {
  const plan = await getCurrentPlan();
  const todayFocus = plan[0]?.focus ?? "上肢力量与核心";
  const exerciseCatalog = exerciseCatalogData as ExerciseCatalogItem[];

  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">Library</span>
          <h2>动作库</h2>
        </div>
        <span className="mini-chip">先检索，再查看动作结果</span>
      </div>

      <ExerciseLibrarySearch catalog={exerciseCatalog} todayFocus={todayFocus} />
    </div>
  );
}
