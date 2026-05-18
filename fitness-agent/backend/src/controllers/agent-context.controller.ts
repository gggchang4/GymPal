import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { AgentWorkItemService } from "../services/agent-work-item.service";
import { AppStoreService } from "../store/app-store.service";

@Controller("agent/context")
export class AgentContextController {
  constructor(
    private readonly store: AppStoreService,
    private readonly workItems: AgentWorkItemService
  ) {}

  @Get("current-plan")
  async getCurrentPlan(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getCurrentPlanSnapshot(user.sub);
  }

  @Get("coach-summary")
  async getCoachSummary(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getCoachSummary(user.sub);
  }

  @Get("memory-summary")
  async getMemorySummary(
    @CurrentUser() user: AuthTokenClaims,
    @Query("categories") categories?: string,
    @Query("tags") tags?: string,
    @Query("includeExpired") includeExpired?: string
  ) {
    return this.store.getMemorySummary(user.sub, {
      categories: splitQueryList(categories),
      tags: splitQueryList(tags),
      includeExpired: includeExpired === "true"
    });
  }

  @Get("workspace-summary")
  async getWorkspaceSummary(@CurrentUser() user: AuthTokenClaims) {
    return this.workItems.buildWorkspaceSummary(user.sub);
  }
}

function splitQueryList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
