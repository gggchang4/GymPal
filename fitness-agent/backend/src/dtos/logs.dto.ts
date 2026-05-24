import { IsArray, IsNumber, IsOptional, IsString } from "class-validator";

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

export class DietLogDto {
  @IsString()
  mealType!: string;

  @IsArray()
  @IsString({ each: true })
  foods!: string[];

  @IsOptional()
  @IsNumber()
  totalCalorie?: number;

  @IsOptional()
  @IsNumber()
  proteinGrams?: number;

  @IsOptional()
  @IsNumber()
  carbohydrateGrams?: number;

  @IsOptional()
  @IsNumber()
  fatGrams?: number;

  @IsOptional()
  @IsString()
  note?: string;
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

