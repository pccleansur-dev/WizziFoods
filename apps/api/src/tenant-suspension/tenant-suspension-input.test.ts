import { describe, expect, it } from "vitest";

import { parseTenantSuspensionRequest } from "./tenant-suspension-input.js";

describe("tenant suspension input", () => {
  it("normalizes a valid commercial request", () => {
    expect(
      parseTenantSuspensionRequest({
        mode: "commercial",
        reason: " Subscription period ended "
      })
    ).toEqual({
      mode: "commercial",
      reason: "Subscription period ended"
    });
  });

  it.each([
    null,
    {},
    { mode: "maintenance", reason: "Planned maintenance" },
    { mode: "security", reason: "x" },
    { mode: "security", reason: "Compromised credentials", tenantId: "x" }
  ])("rejects malformed suspension data", (input) => {
    expect(() => parseTenantSuspensionRequest(input)).toThrow(
      "Datos de suspensión inválidos."
    );
  });
});
