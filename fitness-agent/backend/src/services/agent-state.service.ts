import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  CreateAgentProposalGroupDto,
  CreateAgentMessageDto,
  CreateAgentProposalDto,
  CreateCoachingPackageDto,
  CreateCoachingReviewSnapshotDto,
  CreateAgentRunDto,
  CreateToolInvocationLogDto,
  ReviseCoachingReviewDto,
  UpdateAgentThreadDto
} from "../dtos/agent.dto";
import { AppStoreService } from "../store/app-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { CoachingOutcomeService } from "./coaching-outcome.service";
import { CoachingStrategyService } from "./coaching-strategy.service";
import { AgentPolicyService } from "./agent-policy.service";
import { AgentQualityService } from "./agent-quality.service";
import { AgentProductEventService } from "./agent-product-event.service";
import { AgentActionExecutorService } from "./agent-action-executor.service";
import {
  executableProposalStatuses,
  isTerminalProposalStatus,
  proposalGroupStatuses,
  proposalStatuses
} from "./agent-status";

type TransactionClient = Prisma.TransactionClient | PrismaClient;
const proposalGroupExecutionInclude = Prisma.validator<Prisma.AgentProposalGroupInclude>()({
  proposals: {
    orderBy: { createdAt: "asc" }
  },
  reviewSnapshot: true
});
type RiskLevel = "low" | "medium" | "high";
const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

function normalizeRiskLevel(value: unknown): RiskLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function maxRiskLevel(values: unknown[]): RiskLevel {
  return values.reduce<RiskLevel>((current, value) => {
    const normalized = normalizeRiskLevel(value);
    return riskRank[normalized] > riskRank[current] ? normalized : current;
  }, "low");
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function readJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildThreadTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Health Agent Chat";
  }

  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

function isDefaultThreadTitle(title: string) {
  return title === "Health Agent Chat" || title === "New chat";
}

@Injectable()
export class AgentStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appStore: AppStoreService,
    private readonly outcomeService: CoachingOutcomeService,
    private readonly strategyService: CoachingStrategyService,
    private readonly policyService: AgentPolicyService,
    private readonly qualityService: AgentQualityService,
    private readonly productEvents: AgentProductEventService,
    private readonly actionExecutor: AgentActionExecutorService
  ) {}

  private async getActor(userId?: string) {
    return this.appStore.getUser(userId);
  }

  private async getThreadForActor(threadId: string, userId?: string) {
    const actor = await this.getActor(userId);
    const thread = await this.prisma.agentThread.findFirst({
      where: { id: threadId, userId: actor.id }
    });

    if (!thread) {
      throw new NotFoundException("Agent thread not found.");
    }

    return { actor, thread };
  }

  private async getRunForActor(runId: string, userId?: string) {
    const actor = await this.getActor(userId);
    const run = await this.prisma.agentRun.findFirst({
      where: {
        id: runId,
        thread: {
          userId: actor.id
        }
      },
      include: {
        steps: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!run) {
      throw new NotFoundException("Agent run not found.");
    }

    return { actor, run };
  }

  private async getProposalForActor(proposalId: string, userId?: string) {
    const actor = await this.getActor(userId);
    const proposal = await this.prisma.agentActionProposal.findFirst({
      where: {
        id: proposalId,
        userId: actor.id
      }
    });

    if (!proposal) {
      throw new NotFoundException("Agent proposal not found.");
    }

    return { actor, proposal };
  }

  private async getReviewForActor(reviewId: string, userId?: string) {
    const actor = await this.getActor(userId);
    const review = await this.prisma.coachingReviewSnapshot.findFirst({
      where: {
        id: reviewId,
        userId: actor.id
      }
    });

    if (!review) {
      throw new NotFoundException("Coaching review snapshot not found.");
    }

    return { actor, review };
  }

  private async getProposalGroupForActor(proposalGroupId: string, userId?: string) {
    const actor = await this.getActor(userId);
    const proposalGroup = await this.prisma.agentProposalGroup.findFirst({
      where: {
        id: proposalGroupId,
        userId: actor.id
      },
      include: proposalGroupExecutionInclude
    });

    if (!proposalGroup) {
      throw new NotFoundException("Agent proposal group not found.");
    }

    return { actor, proposalGroup };
  }

  private mapMessage(message: {
    id: string;
    role: string;
    content: string;
    reasoning: string | null;
    cards: Prisma.JsonValue | null;
    createdAt: Date;
  }) {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      reasoning_summary: message.reasoning,
      cards: Array.isArray(message.cards) ? message.cards : [],
      created_at: message.createdAt.toISOString()
    };
  }

  private mapThread(thread: {
    id: string;
    title: string;
    summary: string | null;
    createdAt: Date;
    updatedAt: Date;
    messages?: Array<{ role: string; content: string; createdAt: Date }>;
    _count?: { messages: number };
  }) {
    const lastMessage = thread.messages?.[0];
    return {
      id: thread.id,
      title: thread.title,
      summary: thread.summary,
      message_count: thread._count?.messages ?? 0,
      last_message_preview: lastMessage?.content.slice(0, 140) ?? null,
      last_message_role: lastMessage?.role ?? null,
      last_message_at: lastMessage?.createdAt.toISOString() ?? null,
      created_at: thread.createdAt.toISOString(),
      updated_at: thread.updatedAt.toISOString()
    };
  }

  private mapProposal(proposal: {
    id: string;
    threadId: string;
    runId: string;
    proposalGroupId: string | null;
    status: string;
    actionType: string;
    entityType: string;
    entityId: string | null;
    title: string;
    summary: string;
    payload: Prisma.JsonValue;
    preview: Prisma.JsonValue;
    riskLevel: string;
    requiresConfirmation: boolean;
    expiresAt: Date | null;
    executedAt: Date | null;
    basePlanId: string | null;
    basePlanVersion: number | null;
    basePlanUpdatedAt: Date | null;
    expectedDayId: string | null;
    expectedDayUpdatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: proposal.id,
      thread_id: proposal.threadId,
      run_id: proposal.runId,
      proposal_group_id: proposal.proposalGroupId,
      status: proposal.status,
      action_type: proposal.actionType,
      entity_type: proposal.entityType,
      entity_id: proposal.entityId,
      title: proposal.title,
      summary: proposal.summary,
      payload: proposal.payload,
      preview: proposal.preview,
      risk_level: proposal.riskLevel,
      requires_confirmation: proposal.requiresConfirmation,
      expires_at: proposal.expiresAt?.toISOString() ?? null,
      executed_at: proposal.executedAt?.toISOString() ?? null,
      base_plan_id: proposal.basePlanId,
      base_plan_version: proposal.basePlanVersion,
      base_plan_updated_at: proposal.basePlanUpdatedAt?.toISOString() ?? null,
      expected_day_id: proposal.expectedDayId,
      expected_day_updated_at: proposal.expectedDayUpdatedAt?.toISOString() ?? null,
      created_at: proposal.createdAt.toISOString(),
      updated_at: proposal.updatedAt.toISOString()
    };
  }

  private mapCoachingReview(review: {
    id: string;
    userId: string;
    threadId: string;
    runId: string | null;
    type: string;
    status: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    title: string;
    summary: string;
    adherenceScore: number | null;
    riskFlags: string[];
    focusAreas: string[];
    recommendationTags: string[];
    inputSnapshot: Prisma.JsonValue;
    resultSnapshot: Prisma.JsonValue;
    strategyTemplateId: string | null;
    strategyVersion: string | null;
    evidence: Prisma.JsonValue | null;
    uncertaintyFlags: string[];
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: review.id,
      user_id: review.userId,
      thread_id: review.threadId,
      run_id: review.runId,
      type: review.type,
      status: review.status,
      period_start: review.periodStart?.toISOString() ?? null,
      period_end: review.periodEnd?.toISOString() ?? null,
      title: review.title,
      summary: review.summary,
      adherence_score: review.adherenceScore,
      risk_flags: review.riskFlags,
      focus_areas: review.focusAreas,
      recommendation_tags: review.recommendationTags,
      input_snapshot: review.inputSnapshot,
      result_snapshot: review.resultSnapshot,
      strategy_template_id: review.strategyTemplateId,
      strategy_version: review.strategyVersion,
      evidence: review.evidence,
      uncertainty_flags: review.uncertaintyFlags,
      created_at: review.createdAt.toISOString(),
      updated_at: review.updatedAt.toISOString()
    };
  }

  private mapProposalGroup(group: {
    id: string;
    threadId: string;
    runId: string;
    userId: string;
    reviewSnapshotId: string | null;
    status: string;
    title: string;
    summary: string;
    preview: Prisma.JsonValue;
    riskLevel: string;
    strategyTemplateId: string | null;
    strategyVersion: string | null;
    policyLabels: string[];
    expiresAt: Date | null;
    executedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    proposals?: Array<Parameters<AgentStateService["mapProposal"]>[0]>;
  }) {
    return {
      id: group.id,
      thread_id: group.threadId,
      run_id: group.runId,
      user_id: group.userId,
      review_snapshot_id: group.reviewSnapshotId,
      status: group.status,
      title: group.title,
      summary: group.summary,
      preview: group.preview,
      risk_level: group.riskLevel,
      strategy_template_id: group.strategyTemplateId,
      strategy_version: group.strategyVersion,
      policy_labels: group.policyLabels,
      expires_at: group.expiresAt?.toISOString() ?? null,
      executed_at: group.executedAt?.toISOString() ?? null,
      proposals: group.proposals?.map((proposal) => this.mapProposal(proposal)) ?? [],
      created_at: group.createdAt.toISOString(),
      updated_at: group.updatedAt.toISOString()
    };
  }

  private async findSupersedableRevisionGroups(
    client: TransactionClient,
    review: Parameters<AgentStateService["mapCoachingReview"]>[0],
    sourceProposalGroupId?: string | null
  ) {
    const candidates = await client.agentProposalGroup.findMany({
      where: {
        userId: review.userId,
        threadId: review.threadId,
        status: { in: ["pending", "approved"] }
      },
      include: {
        proposals: { orderBy: { createdAt: "asc" } },
        reviewSnapshot: true
      },
      orderBy: { createdAt: "asc" }
    });

    return candidates.filter((group) => {
      const inputSnapshot = readJsonObject(group.reviewSnapshot?.inputSnapshot);
      const preview = readJsonObject(group.preview);
      const revision = readJsonObject(preview.revision);

      return (
        group.reviewSnapshotId === review.id ||
        inputSnapshot.sourceReviewId === review.id ||
        revision.sourceReviewId === review.id ||
        group.id === sourceProposalGroupId
      );
    });
  }

  private async lockRevisionSource(client: TransactionClient, reviewId: string) {
    // Serialize revision creation per source review so concurrent requests leave one executable latest package.
    await client.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('agent_revision'), hashtext(${reviewId}))`);
  }

  private buildRevisionPackageDraft(input: {
    review: Parameters<AgentStateService["mapCoachingReview"]>[0];
    sourceGroup?: { id: string; status: string } | null;
    runId: string;
    requestId: string;
    revisionReason: string;
  }) {
    const { review, sourceGroup, runId, requestId, revisionReason } = input;
    const revisionSummary = [
      "A conservative revision was generated from the prior coaching review.",
      `Reason: ${revisionReason}.`,
      "The previous executable package, if any, is no longer confirmable."
    ].join(" ");
    const changes = [
      "Reduce the immediate impact of the recommendation.",
      "Prefer an advice snapshot before making plan or diet changes.",
      "Keep the new package behind explicit confirmation."
    ];
    const reviewPayload: CreateCoachingReviewSnapshotDto = {
      runId,
      type: `${review.type}_revision`,
      title: `Revision: ${review.title}`,
      summary: revisionSummary,
      adherenceScore: review.adherenceScore ?? undefined,
      riskFlags: [...new Set(["revision", "conservative_adjustment", ...review.riskFlags])],
      focusAreas: review.focusAreas.length ? review.focusAreas : ["recovery", "consistency"],
      recommendationTags: [...new Set(["revision", "conservative_adjustment", ...review.recommendationTags])],
      inputSnapshot: {
        sourceReviewId: review.id,
        sourceProposalGroupId: sourceGroup?.id ?? null,
        sourceProposalGroupStatus: sourceGroup?.status ?? null,
        revisionReason,
        requestId
      },
      resultSnapshot: {
        previousSummary: review.summary,
        revisedSummary: revisionSummary,
        changes
      },
      strategyTemplateId: review.strategyTemplateId ?? undefined,
      strategyVersion: review.strategyVersion ?? undefined,
      evidence: {
        sourceReviewId: review.id,
        sourceProposalGroupId: sourceGroup?.id ?? null,
        revisionReason,
        requestedAt: new Date().toISOString()
      },
      uncertaintyFlags: [...new Set(["revision_requires_confirmation", ...review.uncertaintyFlags])]
    };
    const proposalGroupPayload: CreateAgentProposalGroupDto = {
      runId,
      title: "Conservative revision package",
      summary: "Create a lower-impact advice snapshot before any stronger plan change.",
      preview: {
        revision: {
          sourceReviewId: review.id,
          sourceProposalGroupId: sourceGroup?.id ?? null,
          previousStatus: sourceGroup?.status ?? null,
          previousSummary: review.summary,
          revisedSummary: revisionSummary,
          changes
        }
      },
      riskLevel: "low",
      strategyTemplateId: review.strategyTemplateId ?? undefined,
      strategyVersion: review.strategyVersion ?? undefined,
      policyLabels: ["coaching_revision", "conservative_adjustment"],
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString()
    };
    const proposalPayload: CreateAgentProposalDto = {
      actionType: "create_advice_snapshot",
      entityType: "advice_snapshot",
      title: "Create revised coaching advice",
      summary: "Persist the safer revised coaching guidance as an advice snapshot.",
      payload: {
        type: "revision",
        priority: "medium",
        summary: revisionSummary,
        reasoningTags: ["coaching_revision", revisionReason],
        actionItems: changes,
        riskFlags: ["conservative_revision"]
      },
      preview: {
        summary: revisionSummary,
        changes
      },
      riskLevel: "low"
    };
    const packagePayload: CreateCoachingPackageDto = {
      review: reviewPayload,
      proposalGroup: proposalGroupPayload,
      proposals: [proposalPayload]
    };

    return {
      reviewPayload,
      proposalGroupPayload,
      proposalPayload,
      packagePayload
    };
  }

  async createThread(title?: string, userId?: string) {
    const actor = await this.getActor(userId);
    const thread = await this.prisma.agentThread.create({
      data: {
        userId: actor.id,
        title: title?.trim() || "Health Agent Chat"
      },
      include: {
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true, content: true, createdAt: true }
        }
      }
    });

    return this.mapThread(thread);
  }

  async listThreads(userId?: string) {
    const actor = await this.getActor(userId);
    const threads = await this.prisma.agentThread.findMany({
      where: { userId: actor.id },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true, content: true, createdAt: true }
        }
      }
    });

    return threads.map((thread) => this.mapThread(thread));
  }

  async getThread(threadId: string, userId?: string) {
    await this.getThreadForActor(threadId, userId);
    const thread = await this.prisma.agentThread.findUniqueOrThrow({
      where: { id: threadId },
      include: {
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true, content: true, createdAt: true }
        }
      }
    });
    return this.mapThread(thread);
  }

  async updateThread(threadId: string, payload: UpdateAgentThreadDto, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const title = payload.title?.replace(/\s+/g, " ").trim();
    const summary = payload.summary?.trim();
    const data: Prisma.AgentThreadUpdateInput = {
      updatedAt: new Date()
    };

    if (title !== undefined) {
      data.title = title || "Health Agent Chat";
    }

    if (summary !== undefined) {
      data.summary = summary || null;
    }

    if (title === undefined && summary === undefined) {
      throw new BadRequestException("No thread fields were provided.");
    }

    const updated = await this.prisma.agentThread.update({
      where: { id: thread.id },
      data,
      include: {
        _count: {
          select: { messages: true }
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { role: true, content: true, createdAt: true }
        }
      }
    });

    return this.mapThread(updated);
  }

  async listMessages(threadId: string, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const messages = await this.prisma.agentMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" }
    });

    return messages.map((message) => this.mapMessage(message));
  }

  async createToolInvocationLog(payload: CreateToolInvocationLogDto, userId?: string) {
    const threadId = payload.requestData.thread_id;
    const runId = payload.requestData.run_id;
    const plannerStep = payload.requestData.planner_step;
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new BadRequestException("requestData.thread_id is required.");
    }
    if (typeof runId !== "string" || !runId.trim()) {
      throw new BadRequestException("requestData.run_id is required.");
    }
    if (plannerStep === undefined || plannerStep === null || plannerStep === "") {
      throw new BadRequestException("requestData.planner_step is required.");
    }

    await this.getThreadForActor(threadId, userId);

    const log = await this.prisma.toolInvocationLog.create({
      data: {
        toolName: payload.toolName,
        status: payload.status,
        requestData: asJson(payload.requestData),
        responseData: asJson(payload.responseData)
      }
    });

    return {
      id: log.id,
      tool_name: log.toolName,
      status: log.status,
      request_data: log.requestData,
      response_data: log.responseData,
      created_at: log.createdAt.toISOString()
    };
  }

  async markMemoryUsed(memoryId: string, userId?: string) {
    const actor = await this.getActor(userId);
    return this.appStore.markCoachingMemoryUsed(actor.id, memoryId);
  }

  async getThreadMemoryState(threadId: string, userId?: string) {
    const { actor, thread } = await this.getThreadForActor(threadId, userId);
    return {
      thread_id: thread.id,
      memory_summary: await this.appStore.getMemorySummary(actor.id)
    };
  }

  async appendMessage(threadId: string, payload: CreateAgentMessageDto, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const existingUserMessageCount =
      payload.role === "user"
        ? await this.prisma.agentMessage.count({
            where: { threadId: thread.id, role: "user" }
          })
        : 0;
    const nextTitle =
      payload.role === "user" && existingUserMessageCount === 0 && isDefaultThreadTitle(thread.title)
        ? buildThreadTitle(payload.content)
        : undefined;

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentMessage.create({
        data: {
          threadId: thread.id,
          role: payload.role,
          content: payload.content,
          reasoning: payload.reasoning,
          cards: payload.cards ? asJson(payload.cards) : Prisma.JsonNull
        }
      });

      await tx.agentThread.update({
        where: { id: thread.id },
        data: {
          ...(nextTitle ? { title: nextTitle } : {}),
          updatedAt: new Date()
        }
      });

      return created;
    });

    return this.mapMessage(message);
  }

  async createRun(threadId: string, payload: CreateAgentRunDto, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const run = await this.prisma.agentRun.create({
      data: {
        id: payload.id,
        threadId: thread.id,
        status: payload.status,
        riskLevel: payload.risk_level,
        steps: {
          create: payload.steps.map((step) => ({
            id: step.id,
            stepType: step.step_type,
            title: step.title,
            payload: asJson(step.payload)
          }))
        }
      },
      include: {
        steps: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    return {
      id: run.id,
      thread_id: run.threadId,
      status: run.status,
      risk_level: run.riskLevel,
      steps: run.steps.map((step) => ({
        id: step.id,
        step_type: step.stepType,
        title: step.title,
        payload: step.payload,
        created_at: step.createdAt.toISOString()
      })),
      created_at: run.createdAt.toISOString()
    };
  }

  async createCoachingPackage(threadId: string, payload: CreateCoachingPackageDto, userId?: string) {
    const { actor, thread } = await this.getThreadForActor(threadId, userId);
    await this.getRunForActor(payload.proposalGroup.runId, actor.id);

    const reviewRunId = payload.review.runId ?? payload.proposalGroup.runId;
    if (reviewRunId !== payload.proposalGroup.runId) {
      throw new ConflictException("The coaching review and proposal group must belong to the same run.");
    }

    const proposalPolicies = payload.proposals.map((proposal) =>
      this.policyService.assertActionAllowed(proposal.actionType, proposal.payload, { packageContext: true })
    );

    const packageExpiresAt =
      payload.proposalGroup.expiresAt ? new Date(payload.proposalGroup.expiresAt) : new Date(Date.now() + 1000 * 60 * 60 * 4);
    const proposalExpiresAtDefault = new Date(Date.now() + 1000 * 60 * 60 * 2);
    const memorySummary = await this.appStore.getMemorySummary(actor.id);
    const strategyDecision = await this.strategyService.chooseForCoachingReview({
      adherenceScore: payload.review.adherenceScore ?? null,
      riskFlags: payload.review.riskFlags ?? [],
      recommendationTags: payload.review.recommendationTags ?? [],
      memoryCount: memorySummary.activeMemories.length
    });
    const strategyTemplateId = payload.review.strategyTemplateId ?? payload.proposalGroup.strategyTemplateId ?? strategyDecision.templateId;
    const strategyVersion = payload.review.strategyVersion ?? payload.proposalGroup.strategyVersion ?? strategyDecision.version;
    const policyLabels = this.policyService.getPolicyLabelsForActions(
      payload.proposals.map((proposal) => proposal.actionType),
      payload.proposalGroup.policyLabels ?? strategyDecision.policyLabels
    );
    const proposalRiskLevels = payload.proposals.map((proposal, index) =>
      maxRiskLevel([proposal.riskLevel, proposalPolicies[index]?.risk])
    );
    const groupRiskLevel = maxRiskLevel([payload.proposalGroup.riskLevel, ...proposalRiskLevels]);
    const effectiveReviewPayload = {
      ...payload.review,
      evidence: payload.review.evidence ?? strategyDecision.evidence,
      uncertaintyFlags: payload.review.uncertaintyFlags ?? strategyDecision.uncertaintyFlags,
      strategyTemplateId,
      strategyVersion
    };

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.coachingReviewSnapshot.create({
        data: {
          userId: actor.id,
          threadId: thread.id,
          runId: reviewRunId,
          type: payload.review.type,
          status: "packaged",
          periodStart: payload.review.periodStart ? new Date(payload.review.periodStart) : undefined,
          periodEnd: payload.review.periodEnd ? new Date(payload.review.periodEnd) : undefined,
          title: payload.review.title,
          summary: payload.review.summary,
          adherenceScore: payload.review.adherenceScore,
          riskFlags: payload.review.riskFlags ?? [],
          focusAreas: payload.review.focusAreas ?? [],
          recommendationTags: payload.review.recommendationTags ?? [],
          inputSnapshot: asJson(payload.review.inputSnapshot ?? {}),
          resultSnapshot: asJson(payload.review.resultSnapshot ?? {}),
          strategyTemplateId,
          strategyVersion,
          evidence: asJson(effectiveReviewPayload.evidence ?? {}),
          uncertaintyFlags: effectiveReviewPayload.uncertaintyFlags ?? []
        }
      });

      const preliminaryQualityDraft = this.qualityService.buildPackageQualityDraft({
        userId: actor.id,
        threadId: thread.id,
        runId: payload.proposalGroup.runId,
        review: effectiveReviewPayload,
        packagePayload: payload,
        riskLevel: groupRiskLevel,
        policyLabels,
        reviewSnapshotId: review.id
      });

      if (preliminaryQualityDraft.status === "blocked") {
        await tx.coachingReviewSnapshot.update({
          where: { id: review.id },
          data: { status: "quality_blocked" }
        });
        const qualityCheck = await this.qualityService.createQualityCheck(preliminaryQualityDraft, tx);
        await this.productEvents.record(
          actor.id,
          {
            eventType: "quality_blocked",
            source: "quality_gate",
            entityType: "coaching_review_snapshot",
            entityId: review.id,
            payload: {
              runId: payload.proposalGroup.runId,
              scope: qualityCheck.scope,
              status: qualityCheck.status,
              blockedReasons: qualityCheck.blocked_reasons
            }
          },
          tx
        );

        return {
          status: "blocked" as const,
          review: {
            ...review,
            status: "quality_blocked"
          },
          qualityCheck
        };
      }

      const proposalGroup = await tx.agentProposalGroup.create({
        data: {
          threadId: thread.id,
          runId: payload.proposalGroup.runId,
          userId: actor.id,
          reviewSnapshotId: review.id,
          status: "pending",
          title: payload.proposalGroup.title,
          summary: payload.proposalGroup.summary,
          preview: asJson(payload.proposalGroup.preview),
          riskLevel: groupRiskLevel,
          strategyTemplateId,
          strategyVersion,
          policyLabels,
          expiresAt: packageExpiresAt
        }
      });

      const proposals = await Promise.all(
        payload.proposals.map((proposal, index) =>
          tx.agentActionProposal.create({
            data: {
              threadId: thread.id,
              runId: payload.proposalGroup.runId,
              userId: actor.id,
              proposalGroupId: proposalGroup.id,
              status: "pending",
              actionType: proposal.actionType,
              entityType: proposal.entityType,
              entityId: proposal.entityId,
              title: proposal.title,
              summary: proposal.summary,
              payload: asJson(proposal.payload),
              preview: asJson(proposal.preview),
              riskLevel: proposalRiskLevels[index],
              requiresConfirmation: proposal.requiresConfirmation ?? true,
              expiresAt: proposal.expiresAt ? new Date(proposal.expiresAt) : proposalExpiresAtDefault,
              basePlanId: proposal.basePlanId,
              basePlanVersion: proposal.basePlanVersion,
              basePlanUpdatedAt: proposal.basePlanUpdatedAt ? new Date(proposal.basePlanUpdatedAt) : undefined,
              expectedDayId: proposal.expectedDayId,
              expectedDayUpdatedAt: proposal.expectedDayUpdatedAt ? new Date(proposal.expectedDayUpdatedAt) : undefined
            }
          })
        )
      );

      const qualityDraft = this.qualityService.buildPackageQualityDraft({
        userId: actor.id,
        threadId: thread.id,
        runId: payload.proposalGroup.runId,
        review: effectiveReviewPayload,
        packagePayload: payload,
        riskLevel: groupRiskLevel,
        policyLabels,
        reviewSnapshotId: review.id,
        proposalGroupId: proposalGroup.id
      });
      const qualityCheck = await this.qualityService.createQualityCheck(qualityDraft, tx);

      return {
        status: "created" as const,
        review,
        proposalGroup,
        proposals,
        qualityCheck
      };
    });

    if (created.status === "blocked") {
      throw new ConflictException("Coaching package was blocked by the coaching quality gate.");
    }

    return {
      review: this.mapCoachingReview(created.review),
      proposal_group: this.mapProposalGroup({
        ...created.proposalGroup,
        proposals: created.proposals
      }),
      proposals: created.proposals.map((proposal) => this.mapProposal(proposal)),
      quality_check: created.qualityCheck
    };
  }

  async getRun(runId: string, userId?: string) {
    const { run } = await this.getRunForActor(runId, userId);
    return {
      id: run.id,
      thread_id: run.threadId,
      status: run.status,
      risk_level: run.riskLevel,
      steps: run.steps.map((step) => ({
        id: step.id,
        step_type: step.stepType,
        title: step.title,
        payload: step.payload,
        created_at: step.createdAt.toISOString()
      })),
      created_at: run.createdAt.toISOString()
    };
  }

  async createProposals(threadId: string, payload: { runId: string; proposals: CreateAgentProposalDto[] }, userId?: string) {
    const { actor, thread } = await this.getThreadForActor(threadId, userId);
    await this.getRunForActor(payload.runId, actor.id);
    const proposalGroupIds = [...new Set(payload.proposals.map((proposal) => proposal.proposalGroupId).filter(Boolean))];
    for (const proposalGroupId of proposalGroupIds) {
      await this.getProposalGroupForActor(String(proposalGroupId), actor.id);
    }

    const proposalPolicies = payload.proposals.map((proposal) =>
      this.policyService.assertActionAllowed(proposal.actionType, proposal.payload, {
        packageContext: Boolean(proposal.proposalGroupId)
      })
    );

    const expiresAtDefault = new Date(Date.now() + 1000 * 60 * 60 * 2);

    const proposals = await this.prisma.$transaction(
      payload.proposals.map((proposal, index) =>
        this.prisma.agentActionProposal.create({
          data: {
            threadId: thread.id,
            runId: payload.runId,
            userId: actor.id,
            proposalGroupId: proposal.proposalGroupId,
            status: "pending",
            actionType: proposal.actionType,
            entityType: proposal.entityType,
            entityId: proposal.entityId,
            title: proposal.title,
            summary: proposal.summary,
            payload: asJson(proposal.payload),
            preview: asJson(proposal.preview),
            riskLevel: maxRiskLevel([proposal.riskLevel, proposalPolicies[index]?.risk]),
            requiresConfirmation: proposal.requiresConfirmation ?? true,
            expiresAt: proposal.expiresAt ? new Date(proposal.expiresAt) : expiresAtDefault,
            basePlanId: proposal.basePlanId,
            basePlanVersion: proposal.basePlanVersion,
            basePlanUpdatedAt: proposal.basePlanUpdatedAt ? new Date(proposal.basePlanUpdatedAt) : undefined,
            expectedDayId: proposal.expectedDayId,
            expectedDayUpdatedAt: proposal.expectedDayUpdatedAt ? new Date(proposal.expectedDayUpdatedAt) : undefined
          }
        })
      )
    );

    return proposals.map((proposal) => this.mapProposal(proposal));
  }

  async createCoachingReview(threadId: string, payload: CreateCoachingReviewSnapshotDto, userId?: string) {
    const { actor, thread } = await this.getThreadForActor(threadId, userId);
    if (payload.runId) {
      await this.getRunForActor(payload.runId, actor.id);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.coachingReviewSnapshot.create({
        data: {
          userId: actor.id,
          threadId: thread.id,
          runId: payload.runId,
          type: payload.type,
          status: payload.status ?? "draft",
          periodStart: payload.periodStart ? new Date(payload.periodStart) : undefined,
          periodEnd: payload.periodEnd ? new Date(payload.periodEnd) : undefined,
          title: payload.title,
          summary: payload.summary,
          adherenceScore: payload.adherenceScore,
          riskFlags: payload.riskFlags ?? [],
          focusAreas: payload.focusAreas ?? [],
          recommendationTags: payload.recommendationTags ?? [],
          inputSnapshot: asJson(payload.inputSnapshot ?? {}),
          resultSnapshot: asJson(payload.resultSnapshot ?? {}),
          strategyTemplateId: payload.strategyTemplateId,
          strategyVersion: payload.strategyVersion,
          evidence: payload.evidence ? asJson(payload.evidence) : undefined,
          uncertaintyFlags: payload.uncertaintyFlags ?? []
        }
      });
      const qualityDraft = this.qualityService.buildReviewQualityDraft({
        userId: actor.id,
        threadId: thread.id,
        runId: payload.runId,
        reviewSnapshotId: review.id,
        review: payload
      });
      const qualityCheck = await this.qualityService.createQualityCheck(qualityDraft, tx);

      return { review, qualityCheck };
    });

    return {
      ...this.mapCoachingReview(created.review),
      quality_check: created.qualityCheck
    };
  }

  async reviseCoachingReview(reviewId: string, payload: ReviseCoachingReviewDto, userId?: string, client?: TransactionClient) {
    const db = client ?? this.prisma;
    const actor = await this.getActor(userId);
    const review = await db.coachingReviewSnapshot.findFirst({
      where: { id: reviewId, userId: actor.id }
    });

    if (!review) {
      throw new NotFoundException("Coaching review snapshot not found.");
    }

    const requestId = payload.requestId?.trim() || randomUUID();
    const revisionReason = payload.revisionReason?.trim() || payload.reason?.trim() || "manual_revision";

    const sourceGroup = payload.sourceProposalGroupId
      ? await db.agentProposalGroup.findFirst({
          where: { id: payload.sourceProposalGroupId, userId: actor.id },
          include: proposalGroupExecutionInclude
        })
      : await db.agentProposalGroup.findFirst({
          where: { userId: actor.id, reviewSnapshotId: review.id },
          include: proposalGroupExecutionInclude,
          orderBy: { createdAt: "desc" }
        });

    if (payload.sourceProposalGroupId && !sourceGroup) {
      throw new NotFoundException("Agent proposal group not found.");
    }

    if (payload.sourceProposalGroupId && sourceGroup) {
      const sourceGroupReviewInput = readJsonObject(sourceGroup.reviewSnapshot?.inputSnapshot);
      const sourceGroupPreview = readJsonObject(sourceGroup.preview);
      const sourceGroupRevision = readJsonObject(sourceGroupPreview.revision);
      const belongsToReview =
        sourceGroup.reviewSnapshotId === review.id ||
        sourceGroupReviewInput.sourceReviewId === review.id ||
        sourceGroupRevision.sourceReviewId === review.id;

      if (!belongsToReview) {
        throw new ConflictException("The source proposal group does not belong to this review.");
      }
    }

    const runId = sourceGroup?.runId ?? review.runId;
    if (!runId) {
      throw new ConflictException("This coaching review is not tied to an agent run and cannot be revised.");
    }
    const run = await db.agentRun.findFirst({
      where: { id: runId, thread: { userId: actor.id } },
      select: { id: true }
    });
    if (!run) {
      throw new NotFoundException("Agent run not found.");
    }

    const revisionDraft = this.buildRevisionPackageDraft({
      review,
      runId,
      sourceGroup,
      requestId,
      revisionReason
    });

    const createRevision = async (tx: TransactionClient) => {
      await this.lockRevisionSource(tx, review.id);

      const groupsToSupersede = await this.findSupersedableRevisionGroups(tx, review, sourceGroup?.id);
      const supersededGroupIds = [...new Set(groupsToSupersede.map((group) => group.id))];
      const supersededReviewIds = [
        ...new Set(groupsToSupersede.map((group) => group.reviewSnapshotId).filter((id): id is string => Boolean(id)))
      ];

      if (supersededGroupIds.length > 0) {
        await tx.agentProposalGroup.updateMany({
          where: { id: { in: supersededGroupIds }, status: { in: ["pending", "approved"] } },
          data: { status: "superseded" }
        });

        await tx.agentActionProposal.updateMany({
          where: { proposalGroupId: { in: supersededGroupIds }, status: { in: ["pending", "approved"] } },
          data: { status: "superseded" }
        });

        if (supersededReviewIds.length > 0) {
          await tx.coachingReviewSnapshot.updateMany({
            where: { id: { in: supersededReviewIds }, status: { in: ["draft", "packaged"] } },
            data: { status: "superseded" }
          });
        }
      }

      const revisionReview = await tx.coachingReviewSnapshot.create({
        data: {
          userId: actor.id,
          threadId: review.threadId,
          runId,
          type: revisionDraft.reviewPayload.type,
          status: "packaged",
          periodStart: review.periodStart ?? undefined,
          periodEnd: review.periodEnd ?? undefined,
          title: revisionDraft.reviewPayload.title,
          summary: revisionDraft.reviewPayload.summary,
          adherenceScore: revisionDraft.reviewPayload.adherenceScore,
          riskFlags: revisionDraft.reviewPayload.riskFlags ?? [],
          focusAreas: revisionDraft.reviewPayload.focusAreas ?? [],
          recommendationTags: revisionDraft.reviewPayload.recommendationTags ?? [],
          inputSnapshot: asJson(revisionDraft.reviewPayload.inputSnapshot ?? {}),
          resultSnapshot: asJson(revisionDraft.reviewPayload.resultSnapshot ?? {}),
          strategyTemplateId: revisionDraft.reviewPayload.strategyTemplateId,
          strategyVersion: revisionDraft.reviewPayload.strategyVersion,
          evidence: asJson(revisionDraft.reviewPayload.evidence ?? {}),
          uncertaintyFlags: revisionDraft.reviewPayload.uncertaintyFlags ?? []
        }
      });

      const policyLabels = this.policyService.getPolicyLabelsForActions(
        [revisionDraft.proposalPayload.actionType],
        revisionDraft.proposalGroupPayload.policyLabels ?? []
      );
      const revisionGroup = await tx.agentProposalGroup.create({
        data: {
          threadId: review.threadId,
          runId,
          userId: actor.id,
          reviewSnapshotId: revisionReview.id,
          status: "pending",
          title: revisionDraft.proposalGroupPayload.title,
          summary: revisionDraft.proposalGroupPayload.summary,
          preview: asJson(revisionDraft.proposalGroupPayload.preview),
          riskLevel: revisionDraft.proposalGroupPayload.riskLevel,
          strategyTemplateId: revisionReview.strategyTemplateId,
          strategyVersion: revisionReview.strategyVersion,
          policyLabels,
          expiresAt: revisionDraft.proposalGroupPayload.expiresAt ? new Date(revisionDraft.proposalGroupPayload.expiresAt) : undefined
        }
      });

      const revisionProposal = await tx.agentActionProposal.create({
        data: {
          threadId: review.threadId,
          runId,
          userId: actor.id,
          proposalGroupId: revisionGroup.id,
          status: "pending",
          actionType: revisionDraft.proposalPayload.actionType,
          entityType: revisionDraft.proposalPayload.entityType,
          entityId: revisionDraft.proposalPayload.entityId,
          title: revisionDraft.proposalPayload.title,
          summary: revisionDraft.proposalPayload.summary,
          payload: asJson(revisionDraft.proposalPayload.payload),
          preview: asJson(revisionDraft.proposalPayload.preview),
          riskLevel: revisionDraft.proposalPayload.riskLevel,
          requiresConfirmation: revisionDraft.proposalPayload.requiresConfirmation ?? true,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 2)
        }
      });

      const qualityDraft = this.qualityService.buildPackageQualityDraft({
        userId: actor.id,
        threadId: review.threadId,
        runId,
        review: revisionDraft.reviewPayload,
        packagePayload: revisionDraft.packagePayload,
        riskLevel: revisionDraft.proposalGroupPayload.riskLevel,
        policyLabels,
        reviewSnapshotId: revisionReview.id,
        proposalGroupId: revisionGroup.id
      });
      const qualityCheck = await this.qualityService.createQualityCheck(qualityDraft, tx);

      await this.productEvents.record(
        actor.id,
        {
          eventType: "revision_requested",
          source: "revision",
          entityType: "agent_proposal_group",
          entityId: revisionGroup.id,
          requestId,
          payload: {
            sourceReviewId: review.id,
            sourceProposalGroupId: sourceGroup?.id ?? null,
            supersededProposalGroupIds: supersededGroupIds,
            revisionReason
          }
        },
        tx
      );

      return {
        revisionReview,
        revisionGroup,
        revisionProposal,
        qualityCheck,
        supersededGroupIds
      };
    };

    const created = client ? await createRevision(client) : await this.prisma.$transaction(createRevision);

    return {
      request_id: requestId,
      source_review: this.mapCoachingReview(review),
      source_proposal_group: sourceGroup ? this.mapProposalGroup(sourceGroup) : null,
      superseded_proposal_group_ids: created.supersededGroupIds,
      review: this.mapCoachingReview(created.revisionReview),
      proposal_group: this.mapProposalGroup({
        ...created.revisionGroup,
        proposals: [created.revisionProposal]
      }),
      proposals: [this.mapProposal(created.revisionProposal)],
      quality_check: created.qualityCheck
    };
  }

  async listCoachingReviews(threadId: string, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const reviews = await this.prisma.coachingReviewSnapshot.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" }
    });

    return reviews.map((review) => this.mapCoachingReview(review));
  }

  async createProposalGroup(threadId: string, payload: CreateAgentProposalGroupDto, userId?: string) {
    const { actor, thread } = await this.getThreadForActor(threadId, userId);
    await this.getRunForActor(payload.runId, actor.id);
    if (payload.reviewSnapshotId) {
      await this.getReviewForActor(payload.reviewSnapshotId, actor.id);
    }

    const proposalGroup = await this.prisma.agentProposalGroup.create({
      data: {
        threadId: thread.id,
        runId: payload.runId,
        userId: actor.id,
        reviewSnapshotId: payload.reviewSnapshotId,
        status: "pending",
        title: payload.title,
        summary: payload.summary,
        preview: asJson(payload.preview),
        riskLevel: payload.riskLevel,
        strategyTemplateId: payload.strategyTemplateId,
        strategyVersion: payload.strategyVersion,
        policyLabels: this.policyService.getPolicyLabelsForActions([], payload.policyLabels ?? []),
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : new Date(Date.now() + 1000 * 60 * 60 * 4)
      },
      include: {
        proposals: true
      }
    });

    if (payload.reviewSnapshotId) {
      await this.prisma.coachingReviewSnapshot.update({
        where: { id: payload.reviewSnapshotId },
        data: { status: "packaged" }
      });
    }

    return this.mapProposalGroup(proposalGroup);
  }

  async listProposalGroups(threadId: string, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const proposalGroups = await this.prisma.agentProposalGroup.findMany({
      where: { threadId: thread.id },
      include: {
        proposals: {
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    return proposalGroups.map((proposalGroup) => this.mapProposalGroup(proposalGroup));
  }

  async listProposals(threadId: string, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const proposals = await this.prisma.agentActionProposal.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" }
    });

    return proposals.map((proposal) => this.mapProposal(proposal));
  }

  async getProposal(proposalId: string, userId?: string) {
    const { proposal } = await this.getProposalForActor(proposalId, userId);
    return this.mapProposal(proposal);
  }

  async getProposalGroup(proposalGroupId: string, userId?: string) {
    const { proposalGroup } = await this.getProposalGroupForActor(proposalGroupId, userId);
    return this.mapProposalGroup(proposalGroup);
  }

  async approveProposal(proposalId: string, userId?: string) {
    const { proposal } = await this.getProposalForActor(proposalId, userId);
    if (proposal.status !== "pending") {
      throw new ConflictException(`Only pending proposals can be approved. Current status: ${proposal.status}.`);
    }

    const updatedCount = await this.prisma.agentActionProposal.updateMany({
      where: { id: proposal.id, status: "pending" },
      data: { status: "approved" }
    });

    if (updatedCount.count !== 1) {
      const latest = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      throw new ConflictException(`Only pending proposals can be approved. Current status: ${latest.status}.`);
    }

    const updated = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    return this.mapProposal(updated);
  }

  async rejectProposal(proposalId: string, userId?: string) {
    const { proposal } = await this.getProposalForActor(proposalId, userId);
    if (!["pending", "approved"].includes(proposal.status)) {
      throw new ConflictException(`This proposal can no longer be rejected. Current status: ${proposal.status}.`);
    }

    const updatedCount = await this.prisma.agentActionProposal.updateMany({
      where: { id: proposal.id, status: { in: ["pending", "approved"] } },
      data: { status: "rejected" }
    });

    if (updatedCount.count !== 1) {
      const latest = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      throw new ConflictException(`This proposal can no longer be rejected. Current status: ${latest.status}.`);
    }

    const updated = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    return this.mapProposal(updated);
  }

  async rejectProposalGroup(proposalGroupId: string, userId?: string) {
    const { proposalGroup } = await this.getProposalGroupForActor(proposalGroupId, userId);
    if (!executableProposalStatuses.includes(proposalGroup.status as (typeof executableProposalStatuses)[number])) {
      throw new ConflictException(`This coaching package can no longer be rejected. Current status: ${proposalGroup.status}.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.agentProposalGroup.update({
        where: { id: proposalGroup.id },
        data: { status: "rejected" }
      });

      await tx.agentActionProposal.updateMany({
        where: {
          proposalGroupId: proposalGroup.id,
          status: { in: [...executableProposalStatuses] }
        },
        data: { status: "rejected" }
      });

      if (proposalGroup.reviewSnapshotId) {
        await tx.coachingReviewSnapshot.update({
          where: { id: proposalGroup.reviewSnapshotId },
          data: { status: "rejected" }
        });
      }

      await this.productEvents.record(
        proposalGroup.userId,
        {
          eventType: "package_rejected",
          source: "chat",
          entityType: "agent_proposal_group",
          entityId: proposalGroup.id,
          payload: {
            previousStatus: proposalGroup.status,
            riskLevel: proposalGroup.riskLevel,
            reviewSnapshotId: proposalGroup.reviewSnapshotId,
            policyLabels: proposalGroup.policyLabels
          }
        },
        tx
      );
    });

    const refreshed = await this.prisma.agentProposalGroup.findUniqueOrThrow({
      where: { id: proposalGroup.id },
      include: { proposals: { orderBy: { createdAt: "asc" } } }
    });

    return this.mapProposalGroup(refreshed);
  }

  async confirmProposal(proposalId: string, idempotencyKey: string, userId?: string) {
    const { actor, proposal } = await this.getProposalForActor(proposalId, userId);
    if (proposal.status === "executed") {
      throw new ConflictException("This proposal has already been executed.");
    }

    if (isTerminalProposalStatus(proposal.status)) {
      throw new ConflictException(`This proposal can no longer be confirmed. Current status: ${proposal.status}.`);
    }

    if (proposal.status === "pending") {
      const updatedCount = await this.prisma.agentActionProposal.updateMany({
        where: { id: proposal.id, status: "pending" },
        data: { status: "approved" }
      });

      if (updatedCount.count !== 1) {
        const latest = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
        if (latest.status === "approved") {
          const resumedExecution = await this.executeApprovedProposal(latest.id, idempotencyKey, actor.id, latest.actionType);
          const resumedProposal = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: latest.id } });
          return {
            proposal: this.mapProposal(resumedProposal),
            execution: resumedExecution
          };
        }

        throw new ConflictException(`This proposal cannot be confirmed. Current status: ${latest.status}.`);
      }
    }

    const approved = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    if (approved.status !== "approved") {
      throw new ConflictException(`This proposal cannot be confirmed. Current status: ${approved.status}.`);
    }

    const execution = await this.executeApprovedProposal(approved.id, idempotencyKey, actor.id, approved.actionType);
    const refreshed = await this.prisma.agentActionProposal.findUniqueOrThrow({ where: { id: approved.id } });
    return {
      proposal: this.mapProposal(refreshed),
      execution
    };
  }

  async confirmProposalGroup(proposalGroupId: string, idempotencyKey: string, userId?: string) {
    const { actor, proposalGroup } = await this.getProposalGroupForActor(proposalGroupId, userId);
    const execution = await this.executeProposalGroup(proposalGroup.id, idempotencyKey, actor.id);
    const refreshed = await this.prisma.agentProposalGroup.findUniqueOrThrow({
      where: { id: proposalGroup.id },
      include: { proposals: { orderBy: { createdAt: "asc" } } }
    });

    return {
      proposal_group: this.mapProposalGroup(refreshed),
      execution
    };
  }

  private async getExistingProposalGroupExecution(proposalGroupId: string, idempotencyKey: string) {
    const executions = await this.prisma.agentActionExecution.findMany({
      where: {
        idempotencyKey,
        proposal: {
          proposalGroupId
        }
      },
      include: {
        proposal: true
      },
      orderBy: { createdAt: "asc" }
    });

    if (!executions.length) {
      return null;
    }

    const proposalCount = await this.prisma.agentActionProposal.count({
      where: { proposalGroupId }
    });

    if (executions.length !== proposalCount) {
      return null;
    }

    const outcome = await this.outcomeService.getOutcomeForProposalGroup(proposalGroupId);

    return {
      ok: executions.every((execution) => execution.status === "succeeded"),
      status: executions.every((execution) => execution.status === "succeeded") ? "succeeded" : "failed",
      proposalGroupId,
      outcomeId: outcome?.id ?? null,
      actions: executions.map((execution) => ({
        proposalId: execution.proposalId,
        actionType: execution.proposal.actionType,
        result: execution.resultPayload,
        status: execution.status,
        errorMessage: execution.errorMessage
      }))
    };
  }

  async executeProposal(proposalId: string, idempotencyKey: string, expectedActionType: string, userId?: string) {
    const { actor, proposal } = await this.getProposalForActor(proposalId, userId);

    return this.executeApprovedProposal(proposal.id, idempotencyKey, actor.id, expectedActionType);
  }

  async executeProposalGroup(proposalGroupId: string, idempotencyKey: string, userId?: string) {
    const actor = await this.getActor(userId);
    const existingExecution = await this.getExistingProposalGroupExecution(proposalGroupId, idempotencyKey);

    if (existingExecution) {
      return existingExecution;
    }

    let shouldMarkFailed = false;
    let lockedProposalGroupId: string | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "AgentProposalGroup" WHERE id = ${proposalGroupId} AND "userId" = ${actor.id} FOR UPDATE`
        );

        if (lockedRows.length === 0) {
          throw new NotFoundException("Agent proposal group not found.");
        }

        const proposalGroup = await tx.agentProposalGroup.findFirst({
          where: { id: proposalGroupId, userId: actor.id },
          include: proposalGroupExecutionInclude
        });

        if (!proposalGroup) {
          throw new NotFoundException("Agent proposal group not found.");
        }

        lockedProposalGroupId = proposalGroup.id;

        if (proposalGroup.status === proposalGroupStatuses.executed) {
          const resumedExecution = await this.getExistingProposalGroupExecution(proposalGroup.id, idempotencyKey);
          if (resumedExecution) {
            return resumedExecution;
          }
          throw new ConflictException("This coaching package has already been executed.");
        }

        if (isTerminalProposalStatus(proposalGroup.status)) {
          throw new ConflictException(`This coaching package can no longer be confirmed. Current status: ${proposalGroup.status}.`);
        }

        if (!executableProposalStatuses.includes(proposalGroup.status as (typeof executableProposalStatuses)[number])) {
          throw new ConflictException(`This coaching package cannot be confirmed. Current status: ${proposalGroup.status}.`);
        }

        if (proposalGroup.expiresAt && proposalGroup.expiresAt.getTime() < Date.now()) {
          await tx.agentProposalGroup.update({
            where: { id: proposalGroup.id },
            data: { status: proposalGroupStatuses.expired }
          });

          await tx.agentActionProposal.updateMany({
            where: {
              proposalGroupId: proposalGroup.id,
              status: { in: [...executableProposalStatuses] }
            },
            data: { status: proposalStatuses.expired }
          });

          if (proposalGroup.reviewSnapshotId) {
            await tx.coachingReviewSnapshot.update({
              where: { id: proposalGroup.reviewSnapshotId },
              data: { status: "expired" }
            });
          }
          throw new ConflictException("This coaching package has expired. Please regenerate it.");
        }

        if (!proposalGroup.proposals.length) {
          throw new ConflictException("This coaching package does not contain executable proposals.");
        }

        for (const proposal of proposalGroup.proposals) {
          await this.assertProposalFresh(proposal.id, actor.id);
        }

        if (proposalGroup.status === proposalGroupStatuses.pending) {
          await tx.agentProposalGroup.update({
            where: { id: proposalGroup.id },
            data: { status: proposalGroupStatuses.approved }
          });
        }

        shouldMarkFailed = true;
        const executedAt = new Date();
        const actionResults: Array<{ proposalId: string; actionType: string; result: unknown }> = [];

        for (const proposal of proposalGroup.proposals) {
          if (proposal.status === proposalStatuses.executed) {
            throw new ConflictException(`Proposal ${proposal.id} has already been executed.`);
          }

          if (!executableProposalStatuses.includes(proposal.status as (typeof executableProposalStatuses)[number])) {
            throw new ConflictException(`Proposal ${proposal.id} cannot be executed in status ${proposal.status}.`);
          }

          const resultPayload = await this.actionExecutor.executePackageAction(
            proposal.actionType,
            proposal.payload as Record<string, unknown>,
            actor.id,
            tx
          );

          await tx.agentActionExecution.create({
            data: {
              proposalId: proposal.id,
              userId: actor.id,
              status: "succeeded",
              requestPayload: asJson(proposal.payload),
              resultPayload: asJson(resultPayload),
              idempotencyKey
            }
          });

          await tx.agentActionProposal.update({
            where: { id: proposal.id },
            data: {
              status: proposalStatuses.executed,
              executedAt
            }
          });

          actionResults.push({
            proposalId: proposal.id,
            actionType: proposal.actionType,
            result: resultPayload
          });
        }

        await tx.agentProposalGroup.update({
          where: { id: proposalGroup.id },
          data: {
            status: proposalGroupStatuses.executed,
            executedAt
          }
        });

        if (proposalGroup.reviewSnapshotId) {
          await tx.coachingReviewSnapshot.update({
            where: { id: proposalGroup.reviewSnapshotId },
            data: { status: "applied" }
          });
        }

        const outcome = await this.outcomeService.createPendingOutcomeForExecutedPackage(tx, {
          proposalGroup,
          actionCount: actionResults.length,
          executedAt
        });

        await this.productEvents.record(
          actor.id,
          {
            eventType: "package_approved",
            source: "chat",
            entityType: "agent_proposal_group",
            entityId: proposalGroup.id,
            requestId: idempotencyKey,
            payload: {
              actionCount: actionResults.length,
              outcomeId: outcome.id,
              riskLevel: proposalGroup.riskLevel,
              reviewSnapshotId: proposalGroup.reviewSnapshotId,
              policyLabels: proposalGroup.policyLabels
            }
          },
          tx
        );

        return {
          ok: true,
          status: "succeeded",
          proposalGroupId: proposalGroup.id,
          outcomeId: outcome.id,
          actions: actionResults
        };
      });

      return result;
    } catch (error) {
      const failedProposalGroupId = lockedProposalGroupId;
      if (shouldMarkFailed && failedProposalGroupId) {
        await this.prisma.$transaction(async (tx) => {
          const latest = await tx.agentProposalGroup.findFirst({
            where: { id: failedProposalGroupId, userId: actor.id },
            select: { id: true, reviewSnapshotId: true }
          });

          if (!latest) {
            return;
          }

          await tx.agentProposalGroup.update({
            where: { id: latest.id },
            data: { status: proposalGroupStatuses.failed }
          });

          await tx.agentActionProposal.updateMany({
            where: {
              proposalGroupId: latest.id,
              status: { in: [...executableProposalStatuses] }
            },
            data: { status: proposalStatuses.failed }
          });

          if (latest.reviewSnapshotId) {
            await tx.coachingReviewSnapshot.update({
              where: { id: latest.reviewSnapshotId },
              data: { status: "failed" }
            });
          }
        });
      }

      throw error;
    }
  }

  private async executeApprovedProposal(
    proposalId: string,
    idempotencyKey: string,
    actorId: string,
    expectedActionType: string
  ) {
    const proposal = await this.prisma.agentActionProposal.findUnique({
      where: { id: proposalId }
    });

    if (!proposal) {
      throw new NotFoundException("Agent proposal not found.");
    }

    if (proposal.actionType !== expectedActionType) {
      throw new ConflictException("Proposal action type does not match this command.");
    }

    if (proposal.proposalGroupId) {
      throw new ConflictException("This proposal belongs to a coaching package and must be executed through the package.");
    }

    if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
      await this.prisma.agentActionProposal.update({
        where: { id: proposal.id },
        data: { status: "expired" }
      });
      throw new ConflictException("This proposal has expired. Refresh and try again.");
    }

    const existingExecution = await this.prisma.agentActionExecution.findUnique({
      where: {
        proposalId_idempotencyKey: {
          proposalId: proposal.id,
          idempotencyKey
        }
      }
    });

    if (existingExecution) {
      return {
        ok: existingExecution.status === "succeeded",
        status: existingExecution.status,
        result: existingExecution.resultPayload
      };
    }

    if (proposal.status === "executed") {
      throw new ConflictException("This proposal has already been executed.");
    }

    if (proposal.status !== "approved") {
      throw new ConflictException("This proposal cannot be executed in its current state.");
    }

    await this.assertProposalFresh(proposal.id, actorId);

    const payload = proposal.payload as Record<string, unknown>;

    try {
      const result = await this.actionExecutor.executeSingle(proposal.actionType, payload, actorId);
      await this.prisma.$transaction(async (tx) => {
        await tx.agentActionExecution.create({
          data: {
            proposalId: proposal.id,
            userId: actorId,
            status: "succeeded",
            requestPayload: asJson(proposal.payload),
            resultPayload: asJson(result),
            idempotencyKey
          }
        });

        await tx.agentActionProposal.update({
          where: { id: proposal.id },
          data: {
            status: "executed",
            executedAt: new Date()
          }
        });
      });

      return { ok: true, status: "succeeded", result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown execution error";

      await this.prisma.$transaction(async (tx) => {
        await tx.agentActionExecution.create({
          data: {
            proposalId: proposal.id,
            userId: actorId,
            status: "failed",
            requestPayload: asJson(proposal.payload),
            resultPayload: Prisma.JsonNull,
            errorMessage,
            idempotencyKey
          }
        });

        await tx.agentActionProposal.update({
          where: { id: proposal.id },
          data: { status: "failed" }
        });
      });

      throw error;
    }
  }

  private async assertProposalFresh(proposalId: string, actorId: string) {
    const proposal = await this.prisma.agentActionProposal.findUnique({
      where: { id: proposalId }
    });

    if (!proposal) {
      throw new NotFoundException("Agent proposal not found.");
    }

    if (!proposal.basePlanId && !proposal.expectedDayId) {
      return;
    }

    const snapshot = await this.appStore.getCurrentPlanSnapshot(actorId);
    const currentPlan = snapshot.plan;

    if (proposal.basePlanId) {
      if (!currentPlan || currentPlan.id !== proposal.basePlanId) {
        throw new ConflictException("The active plan has changed. Please regenerate the proposal.");
      }

      if (
        proposal.basePlanVersion !== null &&
        proposal.basePlanVersion !== undefined &&
        currentPlan.version !== proposal.basePlanVersion
      ) {
        throw new ConflictException("The active plan version has changed. Please regenerate the proposal.");
      }

      if (
        proposal.basePlanUpdatedAt &&
        new Date(currentPlan.updatedAt).getTime() !== proposal.basePlanUpdatedAt.getTime()
      ) {
        throw new ConflictException("The active plan has been updated since this proposal was created.");
      }
    }

    if (proposal.expectedDayId) {
      const currentDay = snapshot.days.find((day) => day.id === proposal.expectedDayId);
      if (!currentDay) {
        throw new ConflictException("The target plan day no longer exists. Please regenerate the proposal.");
      }

      if (
        proposal.expectedDayUpdatedAt &&
        currentDay.updatedAt &&
        new Date(currentDay.updatedAt).getTime() !== proposal.expectedDayUpdatedAt.getTime()
      ) {
        throw new ConflictException("The target plan day has changed. Please regenerate the proposal.");
      }
    }
  }

}
