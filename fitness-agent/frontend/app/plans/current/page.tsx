import { PlanChecklist } from "@/components/plan-checklist";
import { ManualContextPanel } from "@/components/manual-context-panel";
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

      <ManualContextPanel
        sourcePage="plans"
        title="补充计划约束"
        description="手动记录本周训练时间、想练部位、不能练的动作等信息。agent 之后调整计划时会读取这些内容。"
        defaultCategory="plan_context"
        placeholder="例如：周三只能训练 45 分钟；周五想练胸；本周不要安排硬拉。"
      />

      <PlanChecklist plan={plan} />
    </div>
  );
}
