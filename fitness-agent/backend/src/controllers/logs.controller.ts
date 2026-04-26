import { Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { BodyMetricDto, DailyCheckinDto, WorkoutLogDto } from "../dtos/logs.dto";
import { AppStoreService } from "../store/app-store.service";

@Controller("logs")
export class LogsController {
  constructor(private readonly store: AppStoreService) {}

  @Post("body-metrics")
  async createBodyMetric(@Body() body: BodyMetricDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.addBodyMetric({ ...body, userId: user.sub });
  }

  @Get("body-metrics")
  async getBodyMetrics(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getBodyMetrics(user.sub);
  }

  @Post("daily-checkins")
  async createDailyCheckin(@Body() body: DailyCheckinDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.addDailyCheckin({ ...body, userId: user.sub });
  }

  @Get("daily-checkins")
  async getDailyCheckins(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getDailyCheckins(user.sub);
  }

  @Post("workouts")
  async createWorkoutLog(@Body() body: WorkoutLogDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.addWorkoutLog({ ...body, userId: user.sub });
  }

  @Get("workouts")
  async getWorkoutLogs(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getWorkoutLogs(user.sub);
  }
}
