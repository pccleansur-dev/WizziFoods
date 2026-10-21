import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  AdminAuthService,
  type VerifiedJwtClaims,
  type JwtVerifier
} from "./admin-auth.service.js";

function verifierWith(claims: VerifiedJwtClaims): JwtVerifier {
  return { verify: async () => claims };
}

const validClaims: VerifiedJwtClaims = {
  aal: "aal2",
  aud: "authenticated",
  role: "authenticated",
  sub: "10000000-0000-4000-8000-000000000001"
};

describe("AdminAuthService", () => {
  it("returns the verified identity for an aal2 administrator session", async () => {
    const service = new AdminAuthService(verifierWith(validClaims));

    await expect(service.authenticate("signed-token")).resolves.toEqual({
      assuranceLevel: "aal2",
      userId: validClaims.sub
    });
  });

  it("rejects an aal1 session with an actionable MFA error", async () => {
    const service = new AdminAuthService(
      verifierWith({ ...validClaims, aal: "aal1" })
    );

    const error = await service
      .authenticate("signed-token")
      .catch((cause) => Promise.resolve(cause as ForbiddenException));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      error: {
        code: "MFA_REQUIRED",
        message: "Se requiere el segundo factor para continuar."
      }
    });
  });

  it("rejects tokens that are not authenticated user sessions", async () => {
    const service = new AdminAuthService(
      verifierWith({ ...validClaims, role: "service_role" })
    );

    await expect(service.authenticate("signed-token")).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("does not expose verifier details when token verification fails", async () => {
    const verifier: JwtVerifier = {
      verify: async () => {
        throw new Error("signature mismatch for secret-token");
      }
    };
    const service = new AdminAuthService(verifier);

    const error = await service
      .authenticate("secret-token")
      .catch((cause) => Promise.resolve(cause as UnauthorizedException));

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      error: {
        code: "INVALID_ACCESS_TOKEN",
        message: "La sesión no es válida o expiró."
      }
    });
  });
});
