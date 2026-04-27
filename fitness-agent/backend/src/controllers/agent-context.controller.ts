import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { AppStoreService } from "../store/app-store.service";

@Controller("agent/context")
export class AgentContextController {
  constructor(private readonly store: AppStoreService) {}

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
}
