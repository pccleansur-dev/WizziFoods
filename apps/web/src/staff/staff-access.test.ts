import { describe, expect, it } from "vitest";

import { parseStaffLoginForm, staffSessionCookieName } from "./staff-access";

describe("staff web access", () => {
  it("normalizes a valid internal login", () => {
    const formData = new FormData();
    formData.set("tenantSlug", "restaurante-demo");
    formData.set("username", "  Ana.Moza ");
    formData.set("pin", "194827");

    expect(parseStaffLoginForm(formData)).toEqual({
      request: { pin: "194827", username: "ana.moza" },
      tenantSlug: "restaurante-demo"
    });
  });

  it("rejects malformed tenant, username or PIN values", () => {
    const formData = new FormData();
    formData.set("tenantSlug", "Restaurante Demo");
    formData.set("username", "ana");
    formData.set("pin", "12345");

    expect(() => parseStaffLoginForm(formData)).toThrow(
      "Datos de acceso inválidos."
    );
  });

  it("creates a tenant-scoped cookie name", () => {
    expect(staffSessionCookieName("restaurante-demo")).toBe(
      "staff_session_restaurante-demo"
    );
  });
});
