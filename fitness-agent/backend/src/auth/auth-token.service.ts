import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthTokenClaims {
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

interface AuthTokenUser {
  id: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthTokenService {
  private readonly secret = process.env.JWT_SECRET ?? "dev-only-health-agent-secret";
  private readonly expiresInSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 60 * 60 * 24 * 7);

  issueToken(user: AuthTokenUser) {
    const now = Math.floor(Date.now() / 1000);
    const claims: AuthTokenClaims = {
      sub: user.id,
      email: user.email,
      name: user.name,
      iat: now,
      exp: now + this.expiresInSeconds
    };

    return this.signClaims(claims);
  }

  verifyToken(token: string) {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new UnauthorizedException("Invalid access token.");
    }

    const expectedSignature = this.sign(`${encodedHeader}.${encodedPayload}`);
    const actualSignature = Buffer.from(encodedSignature);
    const expectedSignatureBuffer = Buffer.from(expectedSignature);

    if (
      actualSignature.length !== expectedSignatureBuffer.length ||
      !timingSafeEqual(actualSignature, expectedSignatureBuffer)
    ) {
      throw new UnauthorizedException("Invalid access token signature.");
    }

    const payload = this.decodeJson<AuthTokenClaims>(encodedPayload);
    if (!payload?.sub || !payload?.email || !payload?.name) {
      throw new UnauthorizedException("Invalid access token payload.");
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      throw new UnauthorizedException("Access token expired.");
    }

    return payload;
  }

  private signClaims(claims: AuthTokenClaims) {
    const encodedHeader = this.encodeJson({ alg: "HS256", typ: "JWT" });
    const encodedPayload = this.encodeJson(claims);
    const signature = this.sign(`${encodedHeader}.${encodedPayload}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private sign(value: string) {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }

  private encodeJson<T extends object>(value: T) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }

  private decodeJson<T>(value: string) {
    try {
      return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
    } catch {
      throw new UnauthorizedException("Invalid access token payload.");
    }
  }
}
