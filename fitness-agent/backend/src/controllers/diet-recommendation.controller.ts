import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { AppStoreService } from "../store/app-store.service";

@Controller("diet-recommendation")
export class DietRecommendationController {
  constructor(private readonly store: AppStoreService) {}

  @Get("today")
  async getTodayDietRecommendation(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getTodayDietRecommendation(user.sub);
  }
}
