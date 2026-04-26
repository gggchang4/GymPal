import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthTokenClaims } from "./auth-token.service";

export const IS_PUBLIC_ROUTE = "isPublicRoute";
export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthTokenClaims => {
    const request = context.switchToHttp().getRequest<{ auth: AuthTokenClaims }>();
    return request.auth;
  }
);
