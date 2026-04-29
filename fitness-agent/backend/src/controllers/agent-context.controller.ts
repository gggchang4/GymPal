import { Controller, Get } from "@nestjs/common";
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
  async getMemorySummary(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getMemorySummary(user.sub);
  }

  @Get("workspace-summary")
  async getWorkspaceSummary(@CurrentUser() user: AuthTokenClaims) {
    return this.workItems.buildWorkspaceSummary(user.sub);
  }
}
