import { Body, Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { ReviseCoachingReviewDto } from "../dtos/agent.dto";
import { AgentStateService } from "../services/agent-state.service";

@Controller("agent/reviews")
export class AgentReviewsController {
  constructor(private readonly agentState: AgentStateService) {}

  @Post(":reviewId/revise")
  async reviseCoachingReview(
    @Param("reviewId") reviewId: string,
    @Body() body: ReviseCoachingReviewDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.agentState.reviseCoachingReview(reviewId, body, user.sub);
  }
}
