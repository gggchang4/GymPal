import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { CreateManualContextDto, UpdateManualContextDto } from "../dtos/manual-context.dto";
import { AppStoreService } from "../store/app-store.service";

@Controller("manual-context")
export class ManualContextController {
  constructor(private readonly store: AppStoreService) {}

  @Get()
  async listManualContexts(@CurrentUser() user: AuthTokenClaims, @Query("sourcePage") sourcePage?: string) {
    return this.store.listManualContexts(user.sub, sourcePage);
  }

  @Post()
  async createManualContext(@Body() body: CreateManualContextDto, @CurrentUser() user: AuthTokenClaims) {
    return this.store.createManualContext(user.sub, body);
  }

  @Patch(":id")
  async updateManualContext(
    @Param("id") id: string,
    @Body() body: UpdateManualContextDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.store.updateManualContext(user.sub, id, body);
  }

  @Delete(":id")
  async deleteManualContext(@Param("id") id: string, @CurrentUser() user: AuthTokenClaims) {
    await this.store.deleteManualContext(user.sub, id);
    return { ok: true, id };
  }
}
