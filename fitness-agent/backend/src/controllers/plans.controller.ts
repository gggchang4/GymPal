import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import {
  AdjustPlanDto,
  CompletePlanSessionDto,
  CreatePlanDayDto,
  GeneratePlanDto,
  UpdatePlanDayDto
} from "../dtos/plans.dto";
import { AppStoreService } from "../store/app-store.service";

@Controller("plans")
export class PlansController {
  constructor(private readonly store: AppStoreService) {}

  @Post("generate")
  async generatePlan(@Body() body: GeneratePlanDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.generatePlan(user.sub, body.goal);
  }

  @Get("current")
  async getCurrentPlan(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getCurrentPlanDays(user.sub);
  }

  @Get("current/snapshot")
  async getCurrentPlanSnapshot(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getCurrentPlanSnapshot(user.sub);
  }

  @Post("current/day")
  async createCurrentPlanDay(@Body() body: CreatePlanDayDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.createCurrentPlanDay(body, user.sub);
  }

  @Patch("current/day/:id")
  async updateCurrentPlanDay(
    @Param("id") dayId: string,
    @Body() body: UpdatePlanDayDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.store.updateCurrentPlanDay(dayId, body, user.sub);
  }

  @Delete("current/day/:id")
  async deleteCurrentPlanDay(@Param("id") dayId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.store.deleteCurrentPlanDay(dayId, user.sub);
  }

  @Post("current/adjust")
  async adjustCurrentPlan(@Body() body: AdjustPlanDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.adjustPlan(user.sub, body.note);
  }

  @Post("current/complete-session")
  async completeCurrentPlan(@Body() body: CompletePlanSessionDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.completeSession(user.sub, body.dayLabel);
  }
}
