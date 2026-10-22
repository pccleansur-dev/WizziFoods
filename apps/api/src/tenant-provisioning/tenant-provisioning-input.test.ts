import { describe, expect, it } from "vitest";

import {
  parseIdempotencyKey,
  parseTenantProvisioningRequest
} from "./tenant-provisioning-input.js";

describe("tenant provisioning input", () => {
  it("normalizes a valid business request", () => {
    expect(
      parseTenantProvisioningRequest({
        adminEmail: "  OWNER@Example.com ",
        name: "  Café Norte  ",
        slug: " Cafe-Norte "
      })
    ).toEqual({
      adminEmail: "owner@example.com",
      name: "Café Norte",
      slug: "cafe-norte"
    });
  });

  it.each([
    null,
    {},
    { adminEmail: "owner", name: "Café", slug: "cafe" },
    { adminEmail: "owner@example.com", name: "C", slug: "cafe" },
    { adminEmail: "owner@example.com", name: "Café", slug: "Café Norte" }
  ])("rejects malformed business data", (input) => {
    expect(() => parseTenantProvisioningRequest(input)).toThrow(
      "Datos del negocio inválidos."
    );
  });

  it("requires a bounded idempotency key", () => {
    expect(parseIdempotencyKey(" request-1 ")).toBe("request-1");
    expect(() => parseIdempotencyKey(undefined)).toThrow(
      "Falta una clave de operación válida."
    );
    expect(() => parseIdempotencyKey("a".repeat(256))).toThrow(
      "Falta una clave de operación válida."
    );
  });
});
