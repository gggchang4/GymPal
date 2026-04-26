import { Controller, Get, Param } from "@nestjs/common";
import { Public } from "../auth/auth.decorators";
import { AppStoreService } from "../store/app-store.service";

@Controller("exercises")
export class ExercisesController {
  constructor(private readonly store: AppStoreService) {}

  @Public()
  @Get()
  async listExercises() {
    return this.store.getExercises();
  }

  @Public()
  @Get(":id")
  async getExercise(@Param("id") id: string) {
    const exercises = await this.store.getExercises();
    return exercises.find((item) => item.id === id) ?? null;
  }
}
