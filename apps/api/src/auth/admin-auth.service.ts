import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

export type VerifiedJwtClaims = {
  aal: "aal1" | "aal2" | undefined;
  aud: string | string[] | undefined;
  role: string | undefined;
  sessionId: string | undefined;
  sub: string | undefined;
};

export interface JwtVerifier {
  verify(token: string): Promise<VerifiedJwtClaims>;
}

export type AdminIdentity = {
  assuranceLevel: "aal2";
  sessionId: string;
  userId: string;
};

const userIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalidAccessToken(): UnauthorizedException {
  return new UnauthorizedException({
    error: {
      code: "INVALID_ACCESS_TOKEN",
      message: "La sesión no es válida o expiró."
    }
  });
}

export class AdminAuthService {
  constructor(private readonly verifier: JwtVerifier) {}

  async authenticate(token: string): Promise<AdminIdentity> {
    let claims: VerifiedJwtClaims;

    try {
      claims = await this.verifier.verify(token);
    } catch {
      throw invalidAccessToken();
    }

    const hasAuthenticatedAudience = Array.isArray(claims.aud)
      ? claims.aud.includes("authenticated")
      : claims.aud === "authenticated";

    if (
      !claims.sub ||
      !userIdPattern.test(claims.sub) ||
      !claims.sessionId ||
      !userIdPattern.test(claims.sessionId) ||
      claims.role !== "authenticated" ||
      !hasAuthenticatedAudience
    ) {
      throw invalidAccessToken();
    }

    if (claims.aal !== "aal2") {
      throw new ForbiddenException({
        error: {
          code: "MFA_REQUIRED",
          message: "Se requiere el segundo factor para continuar."
        }
      });
    }

    return {
      assuranceLevel: "aal2",
      sessionId: claims.sessionId,
      userId: claims.sub
    };
  }
}
