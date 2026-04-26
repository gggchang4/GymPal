import { Body, Controller, Post } from "@nestjs/common";
import { Public } from "../auth/auth.decorators";
import { AuthTokenService } from "../auth/auth-token.service";
import { AuthDto } from "../dtos/auth.dto";
import { AppStoreService } from "../store/app-store.service";

function buildUserName(email: string, preferredName?: string) {
  if (preferredName && preferredName.trim().length > 0) {
    return preferredName.trim();
  }

  const localPart = email.split("@")[0] ?? "GymPal Member";
  const derived = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return derived || "GymPal Member";
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly store: AppStoreService,
    private readonly authTokenService: AuthTokenService
  ) {}

  @Public()
  @Post("register")
  async register(@Body() body: AuthDto) {
    const user = await this.store.createUser(body.email, body.password, body.name);
    const resolvedName = buildUserName(user.email, user.name);
    return {
      ok: true,
      userId: user.id,
      name: resolvedName,
      email: user.email,
      token: this.authTokenService.issueToken({
        id: user.id,
        email: user.email,
        name: resolvedName
      }),
      message: "Registration succeeded."
    };
  }

  @Public()
  @Post("login")
  async login(@Body() body: AuthDto) {
    const user = await this.store.authenticate(body.email, body.password);
    if (!user) {
      return { ok: false, message: "Invalid credentials" };
    }
    const resolvedName = buildUserName(user.email, user.name);
    return {
      ok: true,
      userId: user.id,
      name: resolvedName,
      email: user.email,
      token: this.authTokenService.issueToken({
        id: user.id,
        email: user.email,
        name: resolvedName
      }),
      message: "Login succeeded."
    };
  }

  @Public()
  @Post("logout")
  logout() {
    return { ok: true };
  }
}
