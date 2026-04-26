import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthTokenClaims } from "./auth-token.service";
import { AuthTokenService } from "./auth-token.service";
import { IS_PUBLIC_ROUTE } from "./auth.decorators";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authTokenService: AuthTokenService
  ) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; auth?: AuthTokenClaims }>();
    const authorization = request.headers.authorization;
    if (!authorization) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    const [scheme, token] = authorization.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("Invalid authorization header.");
    }

    request.auth = this.authTokenService.verifyToken(token);
    return true;
  }
}
