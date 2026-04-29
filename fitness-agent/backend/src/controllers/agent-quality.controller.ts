import { Controller, Get, Param } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthTokenClaims } from "../auth/auth-token.service";
import { AgentQualityService } from "../services/agent-quality.service";

@Controller("agent/quality")
export class AgentQualityController {
  constructor(private readonly quality: AgentQualityService) {}

  @Get("runs/:runId")
  async listRunChecks(@Param("runId") runId: string, @CurrentUser() user: AuthTokenClaims) {
    return this.quality.listForRun(runId, user.sub);
  }

  @Get("proposal-groups/:proposalGroupId")
  async listProposalGroupChecks(
    @Param("proposalGroupId") proposalGroupId: string,
    @CurrentUser() user: AuthTokenClaims
  ) {
    return this.quality.listForProposalGroup(proposalGroupId, user.sub);
  }
}
