import { IsArray, IsObject, IsOptional, IsString } from "class-validator";

export class CreateManualContextDto {
  @IsString()
  sourcePage!: string;

  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  value?: Record<string, unknown>;
}

export class UpdateManualContextDto {
  @IsOptional()
  @IsString()
  sourcePage?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  value?: Record<string, unknown>;
}
