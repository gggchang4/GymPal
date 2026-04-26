import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsOptional, IsString } from "class-validator";

export class GeneratePlanDto {
  @IsOptional()
  @IsString()
  goal?: string;
}

export class AdjustPlanDto {
  @IsString()
  note!: string;
}

export class CompletePlanSessionDto {
  @IsString()
  dayLabel!: string;
}

export class CreatePlanDayDto {
  @IsString()
  dayLabel!: string;

  @IsString()
  focus!: string;

  @IsString()
  duration!: string;

  @IsArray()
  @IsString({ each: true })
  exercises!: string[];

  @IsString()
  recoveryTip!: string;
}

export class UpdatePlanDayDto {
  @IsOptional()
  @IsString()
  dayLabel?: string;

  @IsOptional()
  @IsString()
  focus?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exercises?: string[];

  @IsOptional()
  @IsString()
  recoveryTip?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isCompleted?: boolean;
}

