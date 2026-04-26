import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.decorators";

@Controller()
export class HealthController {
  @Public()
  @Get("healthz")
  getHealth() {
    return { status: "ok" };
  }
}
