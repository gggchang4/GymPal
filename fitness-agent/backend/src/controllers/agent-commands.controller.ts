import { Body, Controller, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { ProposalExecutionDto, ProposalGroupExecutionDto } from "../dtos/agent.dto";
import { AgentStateService } from "../services/agent-state.service";

@Controller("agent/commands")
export class AgentCommandsController {
  constructor(private readonly agentState: AgentStateService) {}

  @Post("generate-plan")
  async generatePlan(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "generate_plan", user.sub);
  }

  @Post("adjust-plan")
  async adjustPlan(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "adjust_plan", user.sub);
  }

  @Post("create-plan-day")
  async createPlanDay(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "create_plan_day", user.sub);
  }

  @Post("update-plan-day")
  async updatePlanDay(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "update_plan_day", user.sub);
  }

  @Post("delete-plan-day")
  async deletePlanDay(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "delete_plan_day", user.sub);
  }

  @Post("complete-plan-day")
  async completePlanDay(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "complete_plan_day", user.sub);
  }

  @Post("create-body-metric")
  async createBodyMetric(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "create_body_metric", user.sub);
  }

  @Post("create-daily-checkin")
  async createDailyCheckin(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "create_daily_checkin", user.sub);
  }

  @Post("create-workout-log")
  async createWorkoutLog(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "create_workout_log", user.sub);
  }

  @Post("apply-coaching-package")
  async applyCoachingPackage(@Body() body: ProposalGroupExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposalGroup(body.proposalGroupId, body.idempotencyKey, user.sub);
  }

  @Post("generate-diet-snapshot")
  async generateDietSnapshot(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "generate_diet_snapshot", user.sub);
  }

  @Post("apply-next-week-plan")
  async applyNextWeekPlan(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "generate_next_week_plan", user.sub);
  }

  @Post("create-advice-snapshot")
  async createAdviceSnapshot(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "create_advice_snapshot", user.sub);
  }

  @Post("create-memory")
  async createMemory(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "create_coaching_memory", user.sub);
  }

  @Post("update-memory")
  async updateMemory(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "update_coaching_memory", user.sub);
  }

  @Post("archive-memory")
  async archiveMemory(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "archive_coaching_memory", user.sub);
  }

  @Post("create-recommendation-feedback")
  async createRecommendationFeedback(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "create_recommendation_feedback", user.sub);
  }

  @Post("refresh-coaching-outcome")
  async refreshCoachingOutcome(@Body() body: ProposalExecutionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.agentState.executeProposal(body.proposalId, body.idempotencyKey, "refresh_coaching_outcome", user.sub);
  }
}
