import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthTokenService } from "./auth/auth-token.service";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { PrismaService } from "./prisma/prisma.service";
import { AppStoreService } from "./store/app-store.service";
import { AuthController } from "./controllers/auth.controller";
import { AgentFeedbackController } from "./controllers/agent-feedback.controller";
import { AgentContextController } from "./controllers/agent-context.controller";
import { AgentCommandsController } from "./controllers/agent-commands.controller";
import { AgentStateController } from "./controllers/agent-state.controller";
import { AgentWorkItemsController } from "./controllers/agent-work-items.controller";
import { AgentQualityController } from "./controllers/agent-quality.controller";
import { DashboardController } from "./controllers/dashboard.controller";
import { DietRecommendationController } from "./controllers/diet-recommendation.controller";
import { ExercisesController } from "./controllers/exercises.controller";
import { HealthController } from "./controllers/health.controller";
import { LogsController } from "./controllers/logs.controller";
import { MeController } from "./controllers/me.controller";
import { PlansController } from "./controllers/plans.controller";
import { AgentStateService } from "./services/agent-state.service";
import { CoachingOutcomeService } from "./services/coaching-outcome.service";
import { CoachingStrategyService } from "./services/coaching-strategy.service";
import { AgentPolicyService } from "./services/agent-policy.service";
import { AgentWorkItemService } from "./services/agent-work-item.service";
import { AgentQualityService } from "./services/agent-quality.service";
import { AgentProductEventService } from "./services/agent-product-event.service";

@Module({
  controllers: [
    AuthController,
    HealthController,
    MeController,
    AgentFeedbackController,
    AgentContextController,
    AgentWorkItemsController,
    AgentQualityController,
    AgentStateController,
    AgentCommandsController,
    DashboardController,
    DietRecommendationController,
    LogsController,
    PlansController,
    ExercisesController
  ],
  providers: [
    PrismaService,
    CoachingStrategyService,
    CoachingOutcomeService,
    AgentPolicyService,
    AppStoreService,
    AgentStateService,
    AgentWorkItemService,
    AgentQualityService,
    AgentProductEventService,
    AuthTokenService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard
    }
  ]
})
export class AppModule {}
