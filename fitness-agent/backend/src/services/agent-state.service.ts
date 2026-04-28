import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  CreateAgentProposalGroupDto,
  CreateAgentMessageDto,
  CreateAgentProposalDto,
  CreateCoachingPackageDto,
  CreateCoachingReviewSnapshotDto,
  CreateAgentRunDto
} from "../dtos/agent.dto";
import { AppStoreService } from "../store/app-store.service";
import { PrismaService } from "../prisma/prisma.service";
import { CoachingOutcomeService } from "./coaching-outcome.service";
import { CoachingStrategyService } from "./coaching-strategy.service";

type TransactionClient = Prisma.TransactionClient | PrismaClient;
const proposalGroupExecutionInclude = Prisma.validator<Prisma.AgentProposalGroupInclude>()({
  proposals: {
    orderBy: { createdAt: "asc" }
  },
  reviewSnapshot: true
});

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

@Injectable()
export class AgentStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appStore: AppStoreService,
    private readonly outcomeService: CoachingOutcomeService,
    private readonly strategyService: CoachingStrategyService
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

  async createThread(title?: string, userId?: string) {
    const actor = await this.getActor(userId);
    return this.prisma.agentThread.create({
      data: {
        userId: actor.id,
        title: title?.trim() || "Health Agent Chat"
      }
    });
  }

  async listMessages(threadId: string, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const messages = await this.prisma.agentMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" }
    });

    return messages.map((message) => this.mapMessage(message));
  }

  async appendMessage(threadId: string, payload: CreateAgentMessageDto, userId?: string) {
    const { thread } = await this.getThreadForActor(threadId, userId);
    const message = await this.prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: payload.role,
        content: payload.content,
        reasoning: payload.reasoning,
        cards: payload.cards ? asJson(payload.cards) : Prisma.JsonNull
      }
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
          evidence: asJson(payload.review.evidence ?? strategyDecision.evidence),
          uncertaintyFlags: payload.review.uncertaintyFlags ?? strategyDecision.uncertaintyFlags
        }
      });

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
          riskLevel: payload.proposalGroup.riskLevel,
          strategyTemplateId,
          strategyVersion,
          policyLabels: payload.proposalGroup.policyLabels ?? strategyDecision.policyLabels,
          expiresAt: packageExpiresAt
        }
      });

      const proposals = await Promise.all(
        payload.proposals.map((proposal) =>
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
              riskLevel: proposal.riskLevel,
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

      return {
        review,
        proposalGroup,
        proposals
      };
    });

    return {
      review: this.mapCoachingReview(created.review),
      proposal_group: this.mapProposalGroup({
        ...created.proposalGroup,
        proposals: created.proposals
      }),
      proposals: created.proposals.map((proposal) => this.mapProposal(proposal))
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

    const expiresAtDefault = new Date(Date.now() + 1000 * 60 * 60 * 2);

    const proposals = await this.prisma.$transaction(
      payload.proposals.map((proposal) =>
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
            riskLevel: proposal.riskLevel,
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

    const review = await this.prisma.coachingReviewSnapshot.create({
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

    return this.mapCoachingReview(review);
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
        policyLabels: payload.policyLabels ?? [],
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
    if (!["pending", "approved"].includes(proposalGroup.status)) {
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
          status: { in: ["pending", "approved"] }
        },
        data: { status: "rejected" }
      });

      if (proposalGroup.reviewSnapshotId) {
        await tx.coachingReviewSnapshot.update({
          where: { id: proposalGroup.reviewSnapshotId },
          data: { status: "rejected" }
        });
      }
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

    if (["rejected", "expired", "failed"].includes(proposal.status)) {
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
    const { actor, proposalGroup } = await this.getProposalGroupForActor(proposalGroupId, userId);
    const existingExecution = await this.getExistingProposalGroupExecution(proposalGroup.id, idempotencyKey);

    if (existingExecution) {
      return existingExecution;
    }

    if (proposalGroup.status === "executed") {
      throw new ConflictException("This coaching package has already been executed.");
    }

    if (["rejected", "expired", "failed"].includes(proposalGroup.status)) {
      throw new ConflictException(`This coaching package can no longer be confirmed. Current status: ${proposalGroup.status}.`);
    }

    if (proposalGroup.expiresAt && proposalGroup.expiresAt.getTime() < Date.now()) {
      await this.prisma.$transaction(async (tx) => {
        await tx.agentProposalGroup.update({
          where: { id: proposalGroup.id },
          data: { status: "expired" }
        });

        await tx.agentActionProposal.updateMany({
          where: {
            proposalGroupId: proposalGroup.id,
            status: { in: ["pending", "approved"] }
          },
          data: { status: "expired" }
        });

        if (proposalGroup.reviewSnapshotId) {
          await tx.coachingReviewSnapshot.update({
            where: { id: proposalGroup.reviewSnapshotId },
            data: { status: "expired" }
          });
        }
      });
      throw new ConflictException("This coaching package has expired. Please regenerate it.");
    }

    if (!proposalGroup.proposals.length) {
      throw new ConflictException("This coaching package does not contain executable proposals.");
    }

    for (const proposal of proposalGroup.proposals) {
      await this.assertProposalFresh(proposal.id, actor.id);
    }

    const lockedGroup = await this.prisma.agentProposalGroup.updateMany({
      where: { id: proposalGroup.id, status: "pending" },
      data: { status: "approved" }
    });

    if (lockedGroup.count !== 1) {
      const resumedExecution = await this.getExistingProposalGroupExecution(proposalGroup.id, idempotencyKey);
      if (resumedExecution) {
        return resumedExecution;
      }

      const latest = await this.prisma.agentProposalGroup.findUniqueOrThrow({ where: { id: proposalGroup.id } });
      throw new ConflictException(`This coaching package cannot be confirmed. Current status: ${latest.status}.`);
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const executedAt = new Date();
        const actionResults: Array<{ proposalId: string; actionType: string; result: unknown }> = [];

        for (const proposal of proposalGroup.proposals) {
          if (proposal.status === "executed") {
            throw new ConflictException(`Proposal ${proposal.id} has already been executed.`);
          }

          if (!["pending", "approved"].includes(proposal.status)) {
            throw new ConflictException(`Proposal ${proposal.id} cannot be executed in status ${proposal.status}.`);
          }

          const resultPayload = await this.dispatchActionWithinTransaction(
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
              status: "executed",
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
            status: "executed",
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
      await this.prisma.$transaction(async (tx) => {
        await tx.agentProposalGroup.update({
          where: { id: proposalGroup.id },
          data: { status: "failed" }
        });

        await tx.agentActionProposal.updateMany({
          where: {
            proposalGroupId: proposalGroup.id,
            status: { in: ["pending", "approved"] }
          },
          data: { status: "failed" }
        });

        if (proposalGroup.reviewSnapshotId) {
          await tx.coachingReviewSnapshot.update({
            where: { id: proposalGroup.reviewSnapshotId },
            data: { status: "failed" }
          });
        }
      });

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
      const result = await this.dispatchAction(proposal.actionType, payload, actorId);
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

  private buildGeneratedPlanPayload(payload: Record<string, unknown>) {
    const rawDays = Array.isArray(payload.days) ? payload.days : [];
    return {
      title: typeof payload.title === "string" ? payload.title : "下周教练计划",
      goal: typeof payload.goal === "string" ? payload.goal : "maintenance",
      weekOf: typeof payload.weekOf === "string" ? payload.weekOf : undefined,
      days: rawDays.map((day, index) => {
        const item = typeof day === "object" && day ? (day as Record<string, unknown>) : {};
        return {
          dayLabel: typeof item.dayLabel === "string" ? item.dayLabel : `训练日 ${index + 1}`,
          focus: typeof item.focus === "string" ? item.focus : "训练安排待补充",
          duration: typeof item.duration === "string" ? item.duration : "45 分钟",
          exercises: normalizeArray(item.exercises),
          recoveryTip: typeof item.recoveryTip === "string" ? item.recoveryTip : "优先保证恢复质量。",
          isCompleted: false,
          sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : index
        };
      })
    };
  }

  private buildGeneratedDietPayload(payload: Record<string, unknown>) {
    const nutritionRatio = typeof payload.nutritionRatio === "object" && payload.nutritionRatio
      ? (payload.nutritionRatio as Record<string, unknown>)
      : { carbohydrate: 45, protein: 30, fat: 25 };
    const nutritionDetail =
      typeof payload.nutritionDetail === "object" && payload.nutritionDetail
        ? (payload.nutritionDetail as Record<string, unknown>)
        : {};

    return {
      date: typeof payload.date === "string" ? payload.date : undefined,
      userGoal: typeof payload.userGoal === "string" ? payload.userGoal : "maintenance",
      totalCalorie: Number(payload.totalCalorie ?? payload.targetCalorie ?? 2000),
      targetCalorie: Number(payload.targetCalorie ?? payload.totalCalorie ?? 2000),
      nutritionRatio: {
        carbohydrate: Number(nutritionRatio.carbohydrate ?? 45),
        protein: Number(nutritionRatio.protein ?? 30),
        fat: Number(nutritionRatio.fat ?? 25)
      },
      nutritionDetail,
      meals:
        Array.isArray(payload.meals) ? payload.meals.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [],
      agentTips: normalizeArray(payload.agentTips)
    };
  }

  private buildGeneratedAdvicePayload(payload: Record<string, unknown>) {
    return {
      type: typeof payload.type === "string" ? payload.type : "weekly_coaching",
      priority: typeof payload.priority === "string" ? payload.priority : "medium",
      summary: typeof payload.summary === "string" ? payload.summary : "根据近期数据生成了一条教练建议。",
      reasoningTags: normalizeArray(payload.reasoningTags),
      actionItems: normalizeArray(payload.actionItems),
      riskFlags: normalizeArray(payload.riskFlags)
    };
  }

  private buildCoachingMemoryPayload(payload: Record<string, unknown>) {
    const value = typeof payload.value === "object" && payload.value ? (payload.value as Record<string, unknown>) : {};
    return {
      memoryType: typeof payload.memoryType === "string" ? payload.memoryType : "behavior_pattern",
      title: typeof payload.title === "string" ? payload.title : "教练记忆",
      summary: typeof payload.summary === "string" ? payload.summary : "用户确认了一条长期教练记忆。",
      value,
      confidence: Number(payload.confidence ?? 60),
      sourceType: typeof payload.sourceType === "string" ? payload.sourceType : "chat",
      sourceId: typeof payload.sourceId === "string" ? payload.sourceId : undefined,
      reason: typeof payload.reason === "string" ? payload.reason : undefined
    };
  }

  private buildPartialCoachingMemoryPayload(payload: Record<string, unknown>) {
    return {
      memoryType: typeof payload.memoryType === "string" ? payload.memoryType : undefined,
      title: typeof payload.title === "string" ? payload.title : undefined,
      summary: typeof payload.summary === "string" ? payload.summary : undefined,
      value: typeof payload.value === "object" && payload.value ? (payload.value as Record<string, unknown>) : undefined,
      confidence: payload.confidence === undefined ? undefined : Number(payload.confidence),
      sourceType: typeof payload.sourceType === "string" ? payload.sourceType : undefined,
      sourceId: typeof payload.sourceId === "string" ? payload.sourceId : undefined,
      reason: typeof payload.reason === "string" ? payload.reason : undefined
    };
  }

  private async dispatchActionWithinTransaction(
    actionType: string,
    payload: Record<string, unknown>,
    userId: string,
    tx: TransactionClient
  ) {
    switch (actionType) {
      case "generate_next_week_plan":
        return this.appStore.generateNextWeekPlan(userId, this.buildGeneratedPlanPayload(payload), tx);
      case "generate_diet_snapshot":
        return this.appStore.createGeneratedDietRecommendation(userId, this.buildGeneratedDietPayload(payload), tx);
      case "create_advice_snapshot":
        return this.appStore.createGeneratedAdviceSnapshot(userId, this.buildGeneratedAdvicePayload(payload), tx);
      case "create_coaching_memory":
        return this.appStore.createCoachingMemory(userId, this.buildCoachingMemoryPayload(payload), tx);
      case "update_coaching_memory":
        if (typeof payload.memoryId !== "string") {
          throw new ConflictException("The proposal is missing the target memory id.");
        }
        return this.appStore.updateCoachingMemory(userId, payload.memoryId, this.buildPartialCoachingMemoryPayload(payload), tx);
      case "archive_coaching_memory":
        if (typeof payload.memoryId !== "string") {
          throw new ConflictException("The proposal is missing the target memory id.");
        }
        return this.appStore.archiveCoachingMemory(userId, payload.memoryId, typeof payload.reason === "string" ? payload.reason : undefined, tx);
      default:
        throw new ConflictException(`Action type ${actionType} is not supported inside a transactional coaching package.`);
    }
  }

  private async dispatchAction(actionType: string, payload: Record<string, unknown>, userId: string) {
    switch (actionType) {
      case "generate_plan":
        return this.appStore.generatePlan(userId, typeof payload.goal === "string" ? payload.goal : "fat_loss");
      case "adjust_plan":
        return this.appStore.adjustPlan(userId, typeof payload.note === "string" ? payload.note : "Adjusted via agent");
      case "create_plan_day":
        return this.appStore.createCurrentPlanDay(
          {
            dayLabel: typeof payload.dayLabel === "string" ? payload.dayLabel : "New day",
            focus: typeof payload.focus === "string" ? payload.focus : "Planned session",
            duration: typeof payload.duration === "string" ? payload.duration : "45 min",
            exercises: normalizeArray(payload.exercises),
            recoveryTip: typeof payload.recoveryTip === "string" ? payload.recoveryTip : "Focus on recovery."
          },
          userId
        );
      case "update_plan_day":
        if (typeof payload.dayId !== "string") {
          throw new ConflictException("The proposal is missing the target day id.");
        }
        return this.appStore.updateCurrentPlanDay(
          payload.dayId,
          {
            dayLabel: typeof payload.dayLabel === "string" ? payload.dayLabel : undefined,
            focus: typeof payload.focus === "string" ? payload.focus : undefined,
            duration: typeof payload.duration === "string" ? payload.duration : undefined,
            exercises: Array.isArray(payload.exercises) ? normalizeArray(payload.exercises) : undefined,
            recoveryTip: typeof payload.recoveryTip === "string" ? payload.recoveryTip : undefined,
            isCompleted: typeof payload.isCompleted === "boolean" ? payload.isCompleted : undefined
          },
          userId
        );
      case "delete_plan_day":
        if (typeof payload.dayId !== "string") {
          throw new ConflictException("The proposal is missing the target day id.");
        }
        return this.appStore.deleteCurrentPlanDay(payload.dayId, userId);
      case "complete_plan_day":
        if (typeof payload.dayId === "string") {
          return this.appStore.updateCurrentPlanDay(payload.dayId, { isCompleted: payload.isCompleted !== false }, userId);
        }
        if (typeof payload.dayLabel === "string") {
          return this.appStore.completeSession(userId, payload.dayLabel);
        }
        throw new ConflictException("The proposal is missing the target day id or label.");
      case "create_body_metric":
        return this.appStore.addBodyMetric({
          userId,
          weightKg: Number(payload.weightKg ?? 0),
          bodyFatPct: payload.bodyFatPct === undefined ? undefined : Number(payload.bodyFatPct),
          waistCm: payload.waistCm === undefined ? undefined : Number(payload.waistCm)
        });
      case "create_daily_checkin":
        return this.appStore.addDailyCheckin({
          userId,
          sleepHours: Number(payload.sleepHours ?? 0),
          waterMl: Number(payload.waterMl ?? 0),
          steps: Number(payload.steps ?? 0),
          energyLevel: typeof payload.energyLevel === "string" ? payload.energyLevel : undefined,
          fatigueLevel: typeof payload.fatigueLevel === "string" ? payload.fatigueLevel : undefined,
          hungerLevel: typeof payload.hungerLevel === "string" ? payload.hungerLevel : undefined
        });
      case "create_workout_log":
        return this.appStore.addWorkoutLog({
          userId,
          workoutType: typeof payload.workoutType === "string" ? payload.workoutType : "general_workout",
          durationMin: Number(payload.durationMin ?? 0),
          intensity: typeof payload.intensity === "string" ? payload.intensity : "moderate",
          exerciseNote: typeof payload.exerciseNote === "string" ? payload.exerciseNote : undefined,
          completion: typeof payload.completion === "string" ? payload.completion : undefined,
          painFeedback: typeof payload.painFeedback === "string" ? payload.painFeedback : undefined,
          fatigueAfter: typeof payload.fatigueAfter === "string" ? payload.fatigueAfter : undefined
        });
      case "generate_next_week_plan":
        return this.appStore.generateNextWeekPlan(userId, this.buildGeneratedPlanPayload(payload));
      case "generate_diet_snapshot":
        return this.appStore.createGeneratedDietRecommendation(userId, this.buildGeneratedDietPayload(payload));
      case "create_advice_snapshot":
        return this.appStore.createGeneratedAdviceSnapshot(userId, this.buildGeneratedAdvicePayload(payload));
      case "create_coaching_memory":
        return this.appStore.createCoachingMemory(userId, this.buildCoachingMemoryPayload(payload));
      case "update_coaching_memory":
        if (typeof payload.memoryId !== "string") {
          throw new ConflictException("The proposal is missing the target memory id.");
        }
        return this.appStore.updateCoachingMemory(userId, payload.memoryId, this.buildPartialCoachingMemoryPayload(payload));
      case "archive_coaching_memory":
        if (typeof payload.memoryId !== "string") {
          throw new ConflictException("The proposal is missing the target memory id.");
        }
        return this.appStore.archiveCoachingMemory(userId, payload.memoryId, typeof payload.reason === "string" ? payload.reason : undefined);
      default:
        throw new ConflictException(`Unsupported action type: ${actionType}`);
    }
  }
}
