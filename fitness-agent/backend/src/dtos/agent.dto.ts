import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested
} from "class-validator";

class AgentCardDto {
  @IsString()
  type!: string;

  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bullets?: string[];

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class CreateAgentThreadDto {
  @IsOptional()
  @IsString()
  title?: string;
}

export class CreateAgentMessageDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  reasoning?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentCardDto)
  cards?: AgentCardDto[];
}

class CreateAgentRunStepDto {
  @IsString()
  id!: string;

  @IsString()
  step_type!: string;

  @IsString()
  title!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

export class CreateAgentRunDto {
  @IsString()
  id!: string;

  @IsIn(["completed", "failed"])
  status!: "completed" | "failed";

  @IsIn(["low", "medium", "high"])
  risk_level!: "low" | "medium" | "high";

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAgentRunStepDto)
  steps!: CreateAgentRunStepDto[];
}

export class CreateAgentProposalDto {
  @IsOptional()
  @IsString()
  proposalGroupId?: string;

  @IsString()
  actionType!: string;

  @IsString()
  entityType!: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsObject()
  preview!: Record<string, unknown>;

  @IsIn(["low", "medium", "high"])
  riskLevel!: "low" | "medium" | "high";

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requiresConfirmation?: boolean;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  basePlanId?: string;

  @IsOptional()
  @Type(() => Number)
  basePlanVersion?: number;

  @IsOptional()
  @IsString()
  basePlanUpdatedAt?: string;

  @IsOptional()
  @IsString()
  expectedDayId?: string;

  @IsOptional()
  @IsString()
  expectedDayUpdatedAt?: string;
}

export class CreateAgentProposalsDto {
  @IsString()
  runId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAgentProposalDto)
  proposals!: CreateAgentProposalDto[];
}

export class ProposalDecisionDto {
  @IsString()
  proposalId!: string;
}

export class ProposalExecutionDto {
  @IsString()
  proposalId!: string;

  @IsString()
  idempotencyKey!: string;
}

export class ProposalGroupExecutionDto {
  @IsString()
  proposalGroupId!: string;

  @IsString()
  idempotencyKey!: string;
}

export class ProposalConfirmDto {
  @IsString()
  idempotencyKey!: string;
}

export class CreateCoachingReviewSnapshotDto {
  @IsOptional()
  @IsString()
  runId?: string;

  @IsString()
  type!: string;

  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number)
  adherenceScore?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  riskFlags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  focusAreas?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recommendationTags?: string[];

  @IsOptional()
  @IsObject()
  inputSnapshot?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  resultSnapshot?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  strategyTemplateId?: string;

  @IsOptional()
  @IsString()
  strategyVersion?: string;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  uncertaintyFlags?: string[];
}

export class CreateAgentProposalGroupDto {
  @IsString()
  runId!: string;

  @IsOptional()
  @IsString()
  reviewSnapshotId?: string;

  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsObject()
  preview!: Record<string, unknown>;

  @IsIn(["low", "medium", "high"])
  riskLevel!: "low" | "medium" | "high";

  @IsOptional()
  @IsString()
  strategyTemplateId?: string;

  @IsOptional()
  @IsString()
  strategyVersion?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  policyLabels?: string[];

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class CreateCoachingPackageDto {
  @ValidateNested()
  @Type(() => CreateCoachingReviewSnapshotDto)
  review!: CreateCoachingReviewSnapshotDto;

  @ValidateNested()
  @Type(() => CreateAgentProposalGroupDto)
  proposalGroup!: CreateAgentProposalGroupDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAgentProposalDto)
  proposals!: CreateAgentProposalDto[];
}

export class ProposalGroupConfirmDto {
  @IsString()
  idempotencyKey!: string;
}
