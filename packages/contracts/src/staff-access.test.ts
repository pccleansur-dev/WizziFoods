import { describe, expect, it } from "vitest";

import {
  STAFF_AUTH_POLICY,
  STAFF_ROLE_CAPABILITIES,
  staffRoleLabels
} from "./staff-access.js";

describe("staff access contract", () => {
  it("keeps the first-version roles fixed", () => {
    expect(Object.keys(STAFF_ROLE_CAPABILITIES)).toEqual([
      "manager",
      "waiter",
      "kitchen",
      "bar"
    ]);
    expect(staffRoleLabels).toEqual({
      bar: "Barra",
      kitchen: "Cocina",
      manager: "Encargado",
      waiter: "Mozo"
    });
  });

  it("does not grant money or floor permissions to production roles", () => {
    expect(STAFF_ROLE_CAPABILITIES.kitchen).toEqual([
      "production.kitchen.manage"
    ]);
    expect(STAFF_ROLE_CAPABILITIES.bar).toEqual(["production.bar.manage"]);
  });

  it("defines bounded PIN and session controls", () => {
    expect(STAFF_AUTH_POLICY).toEqual({
      lockDurationMinutes: 15,
      maxFailedAttempts: 5,
      pinLength: 6,
      sensitiveRevalidationMinutes: 15,
      sessionDurationHours: 8
    });
  });
});
