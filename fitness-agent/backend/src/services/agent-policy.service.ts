import { ConflictException, Injectable } from "@nestjs/common";

const ACTION_POLICIES: Record<string, { label: string; packageAllowed: boolean; risk: "low" | "medium" | "high" }> = {
  generate_plan: { label: "plan_rewrite", packageAllowed: false, risk: "high" },
  adjust_plan: { label: "plan_rewrite", packageAllowed: false, risk: "high" },
  create_plan_day: { label: "plan_rewrite", packageAllowed: false, risk: "medium" },
  update_plan_day: { label: "plan_rewrite", packageAllowed: false, risk: "medium" },
  delete_plan_day: { label: "plan_rewrite", packageAllowed: false, risk: "high" },
  complete_plan_day: { label: "low_risk_write", packageAllowed: false, risk: "low" },
  create_body_metric: { label: "low_risk_write", packageAllowed: false, risk: "low" },
  create_daily_checkin: { label: "low_risk_write", packageAllowed: false, risk: "low" },
  create_workout_log: { label: "low_risk_write", packageAllowed: false, risk: "low" },
  generate_next_week_plan: { label: "plan_rewrite", packageAllowed: true, risk: "high" },
  generate_diet_snapshot: { label: "nutrition_rewrite", packageAllowed: true, risk: "high" },
  create_advice_snapshot: { label: "low_risk_write", packageAllowed: true, risk: "medium" },
  create_coaching_memory: { label: "memory_update", packageAllowed: true, risk: "medium" },
  update_coaching_memory: { label: "memory_update", packageAllowed: true, risk: "medium" },
  archive_coaching_memory: { label: "memory_update", packageAllowed: true, risk: "medium" },
  create_recommendation_feedback: { label: "low_risk_write", packageAllowed: true, risk: "low" },
  refresh_coaching_outcome: { label: "read_only", packageAllowed: false, risk: "low" }
};

const RED_FLAG_PATTERNS = [
  /chest\s*pain/i,
  /faint(?:ed|ing)?/i,
  /black(?:ed)?\s*out/i,
  /prescription/i,
  /medication/i,
  /extreme\s+weight\s+loss/i,
  /胸痛/u,
  /晕厥/u,
  /昏厥/u,
  /处方/u,
  /药物/u,
  /极端减重/u
];

function collectText(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output));
    return output;
  }

  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectText(item, output));
  }

  return output;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

@Injectable()
export class AgentPolicyService {
  getSupportedActionTypes() {
    return Object.keys(ACTION_POLICIES);
  }

  getPolicyForAction(actionType: string) {
    return ACTION_POLICIES[actionType] ?? null;
  }

  getPolicyLabelsForActions(actionTypes: string[], existingLabels: string[] = []) {
    const labels = actionTypes
      .map((actionType) => this.getPolicyForAction(actionType)?.label)
      .filter((label): label is string => Boolean(label));

    if (actionTypes.length > 1) {
      labels.push("multi_domain_package");
    }

    return unique([...existingLabels, ...labels]);
  }

  detectRedFlags(payload: unknown) {
    const text = collectText(payload).join("\n");
    return RED_FLAG_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  }

  assertActionAllowed(actionType: string, payload: unknown, options: { packageContext?: boolean } = {}) {
    const policy = this.getPolicyForAction(actionType);
    if (!policy) {
      throw new ConflictException(`Unsupported action type: ${actionType}`);
    }

    if (options.packageContext && !policy.packageAllowed) {
      throw new ConflictException(`Action type ${actionType} is not supported inside a transactional coaching package.`);
    }

    const redFlags = this.detectRedFlags(payload);
    if (redFlags.length > 0) {
      throw new ConflictException("Medical red-flag content cannot be written by the agent. Provide non-medical guidance only.");
    }

    return policy;
  }

  buildRiskExplanation(actionType: string) {
    const policy = this.getPolicyForAction(actionType);
    if (!policy) {
      return "This action is not allowed by the agent policy.";
    }

    if (policy.label === "read_only") {
      return "Read-only action. No user data is changed.";
    }

    if (policy.label === "memory_update") {
      return "Memory update. User confirmation is required because it can affect future recommendations.";
    }

    if (policy.label === "plan_rewrite" || policy.label === "nutrition_rewrite") {
      return "High-impact coaching change. User confirmation is required before writing to the database.";
    }

    return "Low-risk write. User confirmation is still required before persistence.";
  }
}
