import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { DismissAgentWorkItemDto, RefreshAgentWorkItemsDto } from "../dtos/agent.dto";
import { AgentWorkItemService } from "../services/agent-work-item.service";

@Controller("agent/work-items")
export class AgentWorkItemsController {
  constructor(private readonly workItems: AgentWorkItemService) {}

  @Get()
  async listWorkItems(@CurrentUser() user: AuthTokenClaims, @Query("includeFinal") includeFinal?: string) {
    return this.workItems.listWorkItems(user.sub, includeFinal === "true");
  }

  @Post("refresh")
  async refreshWorkItems(@Body() body: RefreshAgentWorkItemsDto, @CurrentUser() user: AuthTokenClaims) {
    return this.workItems.refreshWorkItems(user.sub, {
      requestId: body.requestId,
      source: body.source
    });
  }

  @Post(":id/open")
  async openWorkItem(@Param("id") id: string, @CurrentUser() user: AuthTokenClaims) {
    return this.workItems.openWorkItem(id, user.sub);
  }

  @Post(":id/dismiss")
  async dismissWorkItem(
    @Param("id") id: string,
    @Body() body: DismissAgentWorkItemDto,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.workItems.dismissWorkItem(id, user.sub, {
      reason: body.reason,
      requestId: body.requestId
    });
  }
}
