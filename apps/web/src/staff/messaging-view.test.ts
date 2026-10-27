import { describe, expect, it } from "vitest";

import { operationModulesFor } from "./operation-modules";
import { STAFF_ROLE_CAPABILITIES } from "@platform/contracts";
import { costLabel, reasonLabel } from "./messaging-view";

describe("messaging view", () => {
  it("explains why a message was blocked in the manager's words", () => {
    expect(reasonLabel("weekly_cap")).toBe("Tope semanal (2)");
    expect(reasonLabel("retries_exhausted: timeout")).toBe(
      "Se agotaron los reintentos"
    );
    expect(reasonLabel("something_new")).toBe("something_new");
    expect(reasonLabel(null)).toBe("");
  });

  it("shows costs in pesos", () => {
    expect(costLabel(500)).toContain("5,00");
  });

  it("offers the messaging module to the manager only", () => {
    const titles = (role: "manager" | "waiter") =>
      operationModulesFor(role, STAFF_ROLE_CAPABILITIES[role]).map(
        ({ title }) => title
      );
    expect(titles("manager")).toContain("Mensajería");
    expect(titles("waiter")).not.toContain("Mensajería");
  });
});
