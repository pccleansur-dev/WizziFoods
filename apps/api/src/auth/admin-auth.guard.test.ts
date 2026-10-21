import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { AdminAuthService } from "./admin-auth.service.js";
import { AdminAuthGuard } from "./admin-auth.guard.js";

function contextFor(authorization?: string): {
  context: ExecutionContext;
  request: { adminIdentity?: unknown; headers: { authorization?: string } };
} {
  const headers = authorization === undefined ? {} : { authorization };
  const request = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request })
  } as ExecutionContext;

  return { context, request };
}

describe("AdminAuthGuard", () => {
  it("attaches the verified identity to the request", async () => {
    const identity = {
      assuranceLevel: "aal2" as const,
      sessionId: "70000000-0000-4000-8000-000000000007",
      userId: "10000000-0000-4000-8000-000000000001"
    };
    const guard = new AdminAuthGuard(
      new AdminAuthService({
        verify: async () => ({
          aal: "aal2",
          aud: "authenticated",
          role: "authenticated",
          sessionId: identity.sessionId,
          sub: identity.userId
        })
      })
    );
    const { context, request } = contextFor("Bearer signed-token");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.adminIdentity).toEqual(identity);
  });

  it("rejects a request without bearer credentials", async () => {
    const guard = new AdminAuthGuard(
      new AdminAuthService({
        verify: async () => {
          throw new Error("verifier should not be called");
        }
      })
    );
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});
