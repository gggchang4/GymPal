import { Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type DbClient = Prisma.TransactionClient | PrismaClient | PrismaService;
type StrategyTemplateEntity = Awaited<ReturnType<PrismaService["coachingStrategyTemplate"]["findMany"]>>[number];

const STRATEGY_VERSION = "1.0.0";

const DEFAULT_STRATEGY_TEMPLATES = [
  {
    key: "minimal_data",
    version: STRATEGY_VERSION,
    title: "数据不足最小建议",
    description: "When follow-up data is thin, keep recommendations conservative and ask for clearer logs.",
    triggerRules: {
      tags: ["outcome_inconclusive", "data_insufficient"],
      completionRateBelow: 1
    },
    riskPolicy: "low_risk_write",
    outputShape: {
      emphasis: ["smallest_actionable_step", "data_collection", "uncertainty"]
    },
    status: "active"
  },
  {
    key: "recovery_priority",
    version: STRATEGY_VERSION,
    title: "恢复优先周",
    description: "Prioritize recovery when fatigue, pain, or negative outcomes appear.",
    triggerRules: {
      riskFlags: ["fatigue", "pain", "recent_negative_outcome", "recent_mixed_outcome"]
    },
    riskPolicy: "multi_domain_package",
    outputShape: {
      emphasis: ["deload", "sleep", "pain_avoidance", "lower_complexity"]
    },
    status: "active"
  },
  {
    key: "personalized_constraints",
    version: STRATEGY_VERSION,
    title: "长期偏好约束",
    description: "Respect confirmed memories such as equipment, schedule, and disliked training modes.",
    triggerRules: {
      memoryRequired: true
    },
    riskPolicy: "memory_update",
    outputShape: {
      emphasis: ["memory_constraints", "preference_fit", "explain_tradeoffs"]
    },
    status: "active"
  },
  {
    key: "progressive_consistency",
    version: STRATEGY_VERSION,
    title: "稳定渐进周",
    description: "Use when execution is stable and recovery signals are manageable.",
    triggerRules: {
      completionRateAtLeast: 60,
      excludesRiskFlags: ["fatigue", "pain", "recent_negative_outcome"]
    },
    riskPolicy: "plan_rewrite",
    outputShape: {
      emphasis: ["progression", "consistency", "measurable_next_steps"]
    },
    status: "active"
  }
] satisfies Array<{
  key: string;
  version: string;
  title: string;
  description: string;
  triggerRules: Record<string, unknown>;
  riskPolicy: string;
  outputShape: Record<string, unknown>;
  status: string;
}>;

export interface CoachingStrategyDecision {
  templateId: string;
  key: string;
  version: string;
  title: string;
  riskPolicy: string;
  policyLabels: string[];
  evidence: Record<string, unknown>;
  uncertaintyFlags: string[];
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function includesAny(values: string[], candidates: string[]) {
  return candidates.some((candidate) =>
    values.some((value) => value.toLowerCase().includes(candidate.toLowerCase()))
  );
}

@Injectable()
export class CoachingStrategyService {
  constructor(private readonly prisma: PrismaService) {}

  private db(client?: DbClient) {
    return client ?? this.prisma;
  }

  async ensureDefaultTemplates(client?: DbClient) {
    const db = this.db(client);
    const templates: StrategyTemplateEntity[] = [];

    for (const template of DEFAULT_STRATEGY_TEMPLATES) {
      templates.push(
        await db.coachingStrategyTemplate.upsert({
          where: {
            key_version: {
              key: template.key,
              version: template.version
            }
          },
          update: {
            title: template.title,
            description: template.description,
            triggerRules: asJson(template.triggerRules),
            riskPolicy: template.riskPolicy,
            outputShape: asJson(template.outputShape),
            status: template.status
          },
          create: {
            key: template.key,
            version: template.version,
            title: template.title,
            description: template.description,
            triggerRules: asJson(template.triggerRules),
            riskPolicy: template.riskPolicy,
            outputShape: asJson(template.outputShape),
            status: template.status
          }
        })
      );
    }

    return templates;
  }

  async listActiveTemplates() {
    await this.ensureDefaultTemplates();
    return this.prisma.coachingStrategyTemplate.findMany({
      where: { status: "active" },
      orderBy: [{ key: "asc" }, { version: "desc" }]
    });
  }

  async chooseForCoachingReview(input: {
    adherenceScore?: number | null;
    riskFlags?: string[];
    recommendationTags?: string[];
    memoryCount?: number;
  }): Promise<CoachingStrategyDecision> {
    const templates = await this.ensureDefaultTemplates();
    const byKey = new Map(templates.map((template) => [template.key, template]));
    const riskFlags = input.riskFlags ?? [];
    const recommendationTags = input.recommendationTags ?? [];
    const memoryCount = input.memoryCount ?? 0;

    let selected =
      byKey.get("progressive_consistency") ??
      templates.find((template) => template.status === "active") ??
      templates[0];
    const uncertaintyFlags: string[] = [];
    const evidence: Record<string, unknown> = {
      riskFlags,
      recommendationTags,
      memoryCount,
      adherenceScore: input.adherenceScore ?? null
    };

    if (includesAny(riskFlags, ["fatigue", "pain", "recent_negative_outcome", "recent_mixed_outcome"])) {
      selected = byKey.get("recovery_priority") ?? selected;
      evidence.selectedBecause = "risk_flags_prioritize_recovery";
    } else if (includesAny(recommendationTags, ["outcome_inconclusive", "data_insufficient"]) || input.adherenceScore === null) {
      selected = byKey.get("minimal_data") ?? selected;
      uncertaintyFlags.push("data_insufficient");
      evidence.selectedBecause = "insufficient_data_limits_confidence";
    } else if (memoryCount > 0) {
      selected = byKey.get("personalized_constraints") ?? selected;
      evidence.selectedBecause = "confirmed_memories_should_constrain_package";
    } else {
      evidence.selectedBecause = "stable_default_progression";
    }

    return {
      templateId: selected.id,
      key: selected.key,
      version: selected.version,
      title: selected.title,
      riskPolicy: selected.riskPolicy,
      policyLabels: [selected.riskPolicy],
      evidence,
      uncertaintyFlags
    };
  }
}
