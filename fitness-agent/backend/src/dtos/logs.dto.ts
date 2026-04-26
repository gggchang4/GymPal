import { IsNumber, IsOptional, IsString } from "class-validator";

export class BodyMetricDto {
  @IsNumber()
  weightKg!: number;

  @IsOptional()
  @IsNumber()
  bodyFatPct?: number;

  @IsOptional()
  @IsNumber()
  waistCm?: number;
}

export class DailyCheckinDto {
  @IsNumber()
  sleepHours!: number;

  @IsNumber()
  waterMl!: number;

  @IsNumber()
  steps!: number;

  @IsOptional()
  @IsString()
  energyLevel?: string;

  @IsOptional()
  @IsString()
  fatigueLevel?: string;

  @IsOptional()
  @IsString()
  hungerLevel?: string;
}

export class WorkoutLogDto {
  @IsString()
  workoutType!: string;

  @IsNumber()
  durationMin!: number;

  @IsString()
  intensity!: string;

  @IsOptional()
  @IsString()
  exerciseNote?: string;

  @IsOptional()
  @IsString()
  completion?: string;

  @IsOptional()
  @IsString()
  painFeedback?: string;

  @IsOptional()
  @IsString()
  fatigueAfter?: string;
}

