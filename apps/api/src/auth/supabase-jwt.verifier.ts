import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { JwtVerifier, VerifiedJwtClaims } from "./admin-auth.service.js";

export class SupabaseJwtVerifier implements JwtVerifier {
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(
    private readonly issuer: string,
    keyResolver?: JWTVerifyGetKey
  ) {
    const normalizedIssuer = issuer.replace(/\/$/u, "");
    this.issuer = normalizedIssuer;
    this.keyResolver =
      keyResolver ??
      createRemoteJWKSet(new URL(`${normalizedIssuer}/.well-known/jwks.json`));
  }

  async verify(token: string): Promise<VerifiedJwtClaims> {
    const { payload } = await jwtVerify(token, this.keyResolver, {
      algorithms: ["ES256"],
      audience: "authenticated",
      issuer: this.issuer
    });

    return {
      aal:
        payload.aal === "aal1" || payload.aal === "aal2"
          ? payload.aal
          : undefined,
      aud: payload.aud,
      role: typeof payload.role === "string" ? payload.role : undefined,
      sessionId:
        typeof payload.session_id === "string" ? payload.session_id : undefined,
      sub: payload.sub
    };
  }
}
