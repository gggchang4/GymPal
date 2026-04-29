import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import {
  CreateAgentMessageDto,
  CreateCoachingPackageDto,
  CreateAgentProposalGroupDto,
  ProposalConfirmDto,
  CreateCoachingReviewSnapshotDto,
  CreateAgentProposalsDto,
  CreateAgentRunDto,
  CreateAgentThreadDto,
  ProposalDecisionDto
} from "../dtos/agent.dto";
import { AgentStateService } from "../services/agent-state.service";
import { CoachingOutcomeService } from "../services/coaching-outcome.service";

@Controller("agent/state")
export class AgentStateController {
  constructor(
    private readonly agentState: AgentStateService,
    private readonly outcomeService: CoachingOutcomeService
  ) {}

  @Post("threads")
  async createThread(@Body() body: CreateAgentThreadDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.createThread(body.title, user.sub);
  }

  @Get("threads/:threadId/messages")
  async listMessages(@Param("threadId") threadId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.listMessages(threadId, user.sub);
  }

  @Get("threads/:threadId/memory-state")
  async getThreadMemoryState(@Param("threadId") threadId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.getThreadMemoryState(threadId, user.sub);
  }

  @Post("threads/:threadId/messages")
  async appendMessage(
    @Param("threadId") threadId: string,
    @Body() body: CreateAgentMessageDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.appendMessage(threadId, body, user.sub);
  }

  @Post("threads/:threadId/runs")
  async createRun(
    @Param("threadId") threadId: string,
    @Body() body: CreateAgentRunDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.createRun(threadId, body, user.sub);
  }

  @Get("runs/:runId")
  async getRun(@Param("runId") runId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.getRun(runId, user.sub);
  }

  @Post("threads/:threadId/proposals")
  async createProposals(
    @Param("threadId") threadId: string,
    @Body() body: CreateAgentProposalsDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.createProposals(threadId, body, user.sub);
  }

  @Post("threads/:threadId/coaching-package")
  async createCoachingPackage(
    @Param("threadId") threadId: string,
    @Body() body: CreateCoachingPackageDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.createCoachingPackage(threadId, body, user.sub);
  }

  @Post("threads/:threadId/reviews")
  async createCoachingReview(
    @Param("threadId") threadId: string,
    @Body() body: CreateCoachingReviewSnapshotDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.createCoachingReview(threadId, body, user.sub);
  }

  @Get("threads/:threadId/reviews")
  async listCoachingReviews(@Param("threadId") threadId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.listCoachingReviews(threadId, user.sub);
  }

  @Get("threads/:threadId/outcomes")
  async listThreadOutcomes(@Param("threadId") threadId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.outcomeService.listThreadOutcomes(threadId, user.sub);
  }

  @Post("threads/:threadId/proposal-groups")
  async createProposalGroup(
    @Param("threadId") threadId: string,
    @Body() body: CreateAgentProposalGroupDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.createProposalGroup(threadId, body, user.sub);
  }

  @Get("threads/:threadId/proposal-groups")
  async listProposalGroups(@Param("threadId") threadId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.listProposalGroups(threadId, user.sub);
  }

  @Get("threads/:threadId/proposals")
  async listProposals(@Param("threadId") threadId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.listProposals(threadId, user.sub);
  }

  @Get("proposals/:proposalId")
  async getProposal(@Param("proposalId") proposalId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.getProposal(proposalId, user.sub);
  }

  @Get("proposal-groups/:proposalGroupId")
  async getProposalGroup(@Param("proposalGroupId") proposalGroupId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.getProposalGroup(proposalGroupId, user.sub);
  }

  @Post("proposals/:proposalId/approve")
  async approveProposal(
    @Param("proposalId") proposalId: string,
    @Body() _body: ProposalDecisionDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.approveProposal(proposalId, user.sub);
  }

  @Post("proposals/:proposalId/reject")
  async rejectProposal(
    @Param("proposalId") proposalId: string,
    @Body() _body: ProposalDecisionDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.rejectProposal(proposalId, user.sub);
  }

  @Post("proposals/:proposalId/confirm")
  async confirmProposal(
    @Param("proposalId") proposalId: string,
    @Body() body: ProposalConfirmDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.confirmProposal(proposalId, body.idempotencyKey, user.sub);
  }

  @Post("proposal-groups/:proposalGroupId/reject")
  async rejectProposalGroup(
    @Param("proposalGroupId") proposalGroupId: string,
    @Body() _body: ProposalDecisionDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.rejectProposalGroup(proposalGroupId, user.sub);
  }

  @Post("proposal-groups/:proposalGroupId/confirm")
  async confirmProposalGroup(
    @Param("proposalGroupId") proposalGroupId: string,
    @Body() body: ProposalConfirmDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.confirmProposalGroup(proposalGroupId, body.idempotencyKey, user.sub);
  }

  @Post("outcomes/refresh-due")
  async refreshDueOutcomes(@CurrentUser() user: AuthTokenClaims) {
    return this.outcomeService.refreshDueOutcomesForUser(user.sub);
  }

  @Post("outcomes/:outcomeId/refresh")
  async refreshOutcome(@Param("outcomeId") outcomeId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.outcomeService.refreshOutcome(outcomeId, user.sub);
  }
}
