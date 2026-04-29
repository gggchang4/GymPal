import { Body, Controller, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { CreateRecommendationFeedbackDto } from "../dtos/agent.dto";
import { AppStoreService } from "../store/app-store.service";

@Controller("agent/feedback")
export class AgentFeedbackController {
  constructor(private readonly store: AppStoreService) {}

  @Post("recommendation")
  async createRecommendationFeedback(
    @Body() body: CreateRecommendationFeedbackDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.store.createRecommendationFeedback(user.sub, body);
  }
}
