import { PlanChecklist } from "@/components/plan-checklist";
import { PageErrorState } from "@/components/page-error-state";
import { getCurrentPlan } from "@/lib/api";
import { requireServerAuthToken } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function CurrentPlanPage() {
  const authToken = requireServerAuthToken();
  let plan;

  try {
    plan = await getCurrentPlan(authToken);
  } catch (error) {
    return <PageErrorState title="本周计划" message={error instanceof Error ? error.message : undefined} />;
  }

  return (
    <div className="page">
      <div className="page-header-compact">
        <div>
          <span className="section-label">计划</span>
          <h2>本周计划</h2>
        </div>
        <span className="mini-chip">执行优先</span>
      </div>

      <PlanChecklist plan={plan} />
    </div>
  );
}
