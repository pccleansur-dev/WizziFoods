import { UnauthorizedException } from "@nestjs/common";

export function extractBearerToken(authorization: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/u.exec(authorization ?? "");

  if (!match?.[1]) {
    throw new UnauthorizedException({
      error: {
        code: "MISSING_ACCESS_TOKEN",
        message: "Se requiere una sesión válida."
      }
    });
  }

  return match[1];
}
