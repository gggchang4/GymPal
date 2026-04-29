import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { CreateCoachingPackageDto, CreateCoachingReviewSnapshotDto } from "../dtos/agent.dto";
import { PrismaService } from "../prisma/prisma.service";
import { AppStoreService } from "../store/app-store.service";
import { AgentPolicyService } from "./agent-policy.service";

type TransactionClient = Prisma.TransactionClient | PrismaClient;
type QualityScope = "work_item" | "review" | "package" | "memory" | "outcome";
type QualityStatus = "passed" | "downgraded" | "blocked";

interface QualityDraft {
  userId: string;
  threadId?: string | null;
  runId?: string | null;
  reviewSnapshotId?: string | null;
  proposalGroupId?: string | null;
  scope: QualityScope;
  status: QualityStatus;
  score: number;
  blockedReasons: string[];
  downgradeReasons: string[];
  passedPolicyLabels: string[];
  evidence: Record<string, unknown>;
}

interface PackageQualityInput {
  userId: string;
  threadId: string;
  runId: string;
  review: CreateCoachingReviewSnapshotDto;
  packagePayload: CreateCoachingPackageDto;
  riskLevel: "low" | "medium" | "high";
  policyLabels: string[];
  reviewSnapshotId?: string;
  proposalGroupId?: string;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function hasObjectContent(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

@Injectable()
export class AgentQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appStore: AppStoreService,
    private readonly policyService: AgentPolicyService = new AgentPolicyService()
  ) {}

  mapQualityCheck(check: {
    id: string;
    userId: string;
    threadId: string | null;
    runId: string | null;
    reviewSnapshotId: string | null;
    proposalGroupId: string | null;
    scope: string;
    status: string;
    score: number;
    blockedReasons: string[];
    downgradeReasons: string[];
    passedPolicyLabels: string[];
    evidence: Prisma.JsonValue;
    createdAt: Date;
  }) {
    return {
      id: check.id,
      user_id: check.userId,
      thread_id: check.threadId,
      run_id: check.runId,
      review_snapshot_id: check.reviewSnapshotId,
      proposal_group_id: check.proposalGroupId,
      scope: check.scope,
      status: check.status,
      score: check.score,
      blocked_reasons: check.blockedReasons,
      downgrade_reasons: check.downgradeReasons,
      passed_policy_labels: check.passedPolicyLabels,
      evidence: check.evidence,
      created_at: check.createdAt.toISOString()
    };
  }

  async listForRun(runId: string, userId?: string) {
    const actor = await this.appStore.getUser(userId);
    const checks = await this.prisma.agentQualityCheck.findMany({
      where: { userId: actor.id, runId },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    return checks.map((check) => this.mapQualityCheck(check));
  }

  async listForProposalGroup(proposalGroupId: string, userId?: string) {
    const actor = await this.appStore.getUser(userId);
    const proposalGroup = await this.prisma.agentProposalGroup.findFirst({
      where: { id: proposalGroupId, userId: actor.id },
      select: { id: true }
    });

    if (!proposalGroup) {
      throw new NotFoundException("Agent proposal group not found.");
    }

    const checks = await this.prisma.agentQualityCheck.findMany({
      where: { userId: actor.id, proposalGroupId },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    return checks.map((check) => this.mapQualityCheck(check));
  }

  async getLatestForUser(userId: string, take = 8) {
    const checks = await this.prisma.agentQualityCheck.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take
    });

    return checks.map((check) => this.mapQualityCheck(check));
  }

  buildReviewQualityDraft(input: {
    userId: string;
    threadId: string;
    runId?: string | null;
    reviewSnapshotId?: string | null;
    review: CreateCoachingReviewSnapshotDto;
  }): QualityDraft {
    let score = 100;
    const blockedReasons: string[] = [];
    const downgradeReasons: string[] = [];
    const labels = ["phase4_quality_gate", "review_snapshot"];
    const reviewText = {
      title: input.review.title,
      summary: input.review.summary,
      riskFlags: input.review.riskFlags ?? [],
      focusAreas: input.review.focusAreas ?? [],
      recommendationTags: input.review.recommendationTags ?? []
    };
    const redFlags = this.policyService.detectRedFlags(reviewText);

    if (redFlags.length > 0) {
      score -= 45;
      blockedReasons.push("medical_red_flag_text");
    }
    if (typeof input.review.adherenceScore !== "number") {
      score -= 12;
      downgradeReasons.push("missing_adherence_score");
    }
    if (!hasObjectContent(input.review.inputSnapshot)) {
      score -= 12;
      downgradeReasons.push("missing_input_snapshot");
    }
    if (!hasObjectContent(input.review.resultSnapshot)) {
      score -= 12;
      downgradeReasons.push("missing_result_snapshot");
    }
    if ((input.review.focusAreas ?? []).length === 0) {
      score -= 8;
      downgradeReasons.push("missing_focus_areas");
    }
    if ((input.review.uncertaintyFlags ?? []).length > 0) {
      score -= 6;
      labels.push("explicit_uncertainty");
    }

    return this.buildDraft({
      userId: input.userId,
      threadId: input.threadId,
      runId: input.runId,
      reviewSnapshotId: input.reviewSnapshotId,
      scope: "review",
      score,
      blockedReasons,
      downgradeReasons,
      passedPolicyLabels: labels,
      evidence: {
        reviewType: input.review.type,
        hasAdherenceScore: typeof input.review.adherenceScore === "number",
        focusAreaCount: input.review.focusAreas?.length ?? 0,
        recommendationTagCount: input.review.recommendationTags?.length ?? 0,
        uncertaintyFlagCount: input.review.uncertaintyFlags?.length ?? 0,
        hasInputSnapshot: hasObjectContent(input.review.inputSnapshot),
        hasResultSnapshot: hasObjectContent(input.review.resultSnapshot),
        redFlagCount: redFlags.length
      }
    });
  }

  buildPackageQualityDraft(input: PackageQualityInput): QualityDraft {
    let score = 100;
    const blockedReasons: string[] = [];
    const downgradeReasons: string[] = [];
    const actionTypes = input.packagePayload.proposals.map((proposal) => proposal.actionType);
    const unsupportedActions = actionTypes.filter((actionType) => !this.policyService.getPolicyForAction(actionType));
    const highRiskActionCount = input.packagePayload.proposals.filter((proposal) => proposal.riskLevel === "high").length;
    const redFlagMatches = input.packagePayload.proposals.flatMap((proposal) =>
      this.policyService.detectRedFlags({
        title: proposal.title,
        summary: proposal.summary,
        payload: proposal.payload,
        preview: proposal.preview
      })
    );

    if (unsupportedActions.length > 0) {
      score -= 50;
      blockedReasons.push("unsupported_action_type");
    }
    if (redFlagMatches.length > 0) {
      score -= 50;
      blockedReasons.push("medical_red_flag_text");
    }
    if (input.packagePayload.proposals.length === 0) {
      score -= 35;
      blockedReasons.push("empty_package");
    }
    if (!hasText(input.packagePayload.proposalGroup.summary)) {
      score -= 10;
      downgradeReasons.push("missing_package_summary");
    }
    if (!hasObjectContent(input.packagePayload.proposalGroup.preview)) {
      score -= 10;
      downgradeReasons.push("missing_package_preview");
    }
    if (!hasObjectContent(input.review.inputSnapshot)) {
      score -= 10;
      downgradeReasons.push("missing_review_input_snapshot");
    }
    if (!hasObjectContent(input.review.evidence)) {
      score -= 8;
      downgradeReasons.push("limited_review_evidence");
    }
    if (input.riskLevel === "high" && input.policyLabels.length === 0) {
      score -= 12;
      downgradeReasons.push("missing_policy_labels_for_high_risk_package");
    }
    if (highRiskActionCount > 0 && typeof input.review.adherenceScore !== "number") {
      score -= 12;
      downgradeReasons.push("high_risk_without_adherence_score");
    }
    if (score < 60 && input.riskLevel === "high") {
      downgradeReasons.push("score_below_high_impact_threshold");
    }

    return this.buildDraft({
      userId: input.userId,
      threadId: input.threadId,
      runId: input.runId,
      reviewSnapshotId: input.reviewSnapshotId,
      proposalGroupId: input.proposalGroupId,
      scope: "package",
      score,
      blockedReasons,
      downgradeReasons,
      passedPolicyLabels: ["phase4_quality_gate", ...input.policyLabels],
      evidence: {
        actionTypes,
        actionCount: input.packagePayload.proposals.length,
        riskLevel: input.riskLevel,
        highRiskActionCount,
        policyLabels: input.policyLabels,
        hasPackagePreview: hasObjectContent(input.packagePayload.proposalGroup.preview),
        hasReviewEvidence: hasObjectContent(input.review.evidence),
        unsupportedActionCount: unsupportedActions.length,
        redFlagCount: redFlagMatches.length
      }
    });
  }

  async createQualityCheck(draft: QualityDraft, client?: TransactionClient) {
    const db = client ?? this.prisma;
    const created = await db.agentQualityCheck.create({
      data: {
        userId: draft.userId,
        threadId: draft.threadId ?? undefined,
        runId: draft.runId ?? undefined,
        reviewSnapshotId: draft.reviewSnapshotId ?? undefined,
        proposalGroupId: draft.proposalGroupId ?? undefined,
        scope: draft.scope,
        status: draft.status,
        score: draft.score,
        blockedReasons: draft.blockedReasons,
        downgradeReasons: draft.downgradeReasons,
        passedPolicyLabels: draft.passedPolicyLabels,
        evidence: asJson(draft.evidence)
      }
    });

    return this.mapQualityCheck(created);
  }

  private buildDraft(input: Omit<QualityDraft, "status" | "score"> & { score: number }): QualityDraft {
    const score = normalizeScore(input.score);
    const status: QualityStatus =
      input.blockedReasons.length > 0 ? "blocked" : input.downgradeReasons.length > 0 || score < 80 ? "downgraded" : "passed";

    return {
      ...input,
      score,
      status
    };
  }
}
