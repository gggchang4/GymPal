import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { AppStoreService } from "../store/app-store.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly store: AppStoreService) {}

  @Get()
  async getDashboard(@CurrentUser() user: AuthTokenClaims) {
    return this.store.getDashboard(user.sub);
  }
}
