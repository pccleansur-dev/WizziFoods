import { STAFF_ROLE_CAPABILITIES } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import { operationModulesFor } from "./operation-modules";

describe("staff operation modules", () => {
  it("shows only kitchen production to kitchen staff", () => {
    expect(
      operationModulesFor("kitchen", STAFF_ROLE_CAPABILITIES.kitchen).map(
        ({ title }) => title
      )
    ).toEqual(["Cocina"]);
  });

  it("links kitchen and bar to the production screen", () => {
    for (const role of ["kitchen", "bar"] as const) {
      const [module] = operationModulesFor(role, STAFF_ROLE_CAPABILITIES[role]);
      expect(module?.path).toBe("produccion");
    }
  });

  it("shows the daily floor modules to a waiter", () => {
    expect(
      operationModulesFor("waiter", STAFF_ROLE_CAPABILITIES.waiter).map(
        ({ title }) => title
      )
    ).toEqual(["Mesas y llamados", "Pedidos", "Cobros"]);
  });

  it("links the waiter modules that already exist to the salon", () => {
    const modules = operationModulesFor(
      "waiter",
      STAFF_ROLE_CAPABILITIES.waiter
    );
    expect(
      modules.find(({ title }) => title === "Mesas y llamados")?.path
    ).toBe("salon");
    expect(modules.find(({ title }) => title === "Pedidos")?.path).toBe(
      "salon?vista=comanda"
    );
    expect(
      modules.find(({ title }) => title === "Cobros")?.path
    ).toBeUndefined();
  });
});
