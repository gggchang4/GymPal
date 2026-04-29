import { Body, Controller, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { CreateRecommendationFeedbackDto } from "../dtos/agent.dto";
import { PrismaService } from "../prisma/prisma.service";
import { AppStoreService } from "../store/app-store.service";
import { AgentProductEventService } from "../services/agent-product-event.service";

@Controller("agent/feedback")
export class AgentFeedbackController {
  constructor(
    private readonly store: AppStoreService,
    private readonly prisma: PrismaService,
    private readonly productEvents: AgentProductEventService
  ) {}

  @Post("recommendation")
  async createRecommendationFeedback(
    @Body() body: CreateRecommendationFeedbackDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.prisma.$transaction(async (tx) => {
      const feedback = await this.store.createRecommendationFeedback(user.sub, body, tx);
      await this.productEvents.record(
        user.sub,
        {
          eventType: "feedback_submitted",
          source: "feedback",
          entityType: "recommendation_feedback",
          entityId: feedback.id,
          payload: {
            feedbackType: feedback.feedbackType,
            reviewSnapshotId: feedback.reviewSnapshotId,
            proposalGroupId: feedback.proposalGroupId,
            hasNote: Boolean(feedback.note)
          }
        },
        tx
      );

      return feedback;
    });
  }
}
