import { describe, expect, it } from "vitest";

import { resolveMfaRoute } from "./mfa-route";

describe("resolveMfaRoute", () => {
  it("sends an unauthenticated visitor back to access", () => {
    expect(resolveMfaRoute(null)).toBe("/acceso");
  });

  it("sends an aal1 session with a verified factor to the challenge", () => {
    expect(
      resolveMfaRoute({
        currentLevel: "aal1",
        nextLevel: "aal2",
        verifiedFactorCount: 1
      })
    ).toBe("/acceso/segundo-factor");
  });

  it("requires enrollment when no verified factor exists", () => {
    expect(
      resolveMfaRoute({
        currentLevel: "aal1",
        nextLevel: "aal1",
        verifiedFactorCount: 0
      })
    ).toBe("/acceso/configurar-segundo-factor");
  });

  it("allows only an aal2 session into the panel", () => {
    expect(
      resolveMfaRoute({
        currentLevel: "aal2",
        nextLevel: "aal2",
        verifiedFactorCount: 1
      })
    ).toBe("/panel");
  });
});
