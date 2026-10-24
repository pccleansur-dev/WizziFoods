import type { ProductionTicket } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  nextProductionStep,
  productionStatusLabel,
  sortProductionTickets
} from "./production-view";

function ticket(
  orderId: string,
  status: ProductionTicket["status"],
  confirmedAt: string
): ProductionTicket {
  return {
    attribution: "table",
    confirmedAt,
    dinerName: null,
    items: [],
    orderId,
    orderStatus: status,
    seatLabel: null,
    status,
    tableId: "t",
    tableLabel: "1"
  };
}

describe("production view helpers", () => {
  it("labels every state in the operators' words", () => {
    expect(productionStatusLabel("queued")).toBe("En cola");
    expect(productionStatusLabel("preparing")).toBe("En preparación");
    expect(productionStatusLabel("in_preparation")).toBe("En preparación");
    expect(productionStatusLabel("ready")).toBe("Listo");
    expect(productionStatusLabel("delivered")).toBe("Entregado");
    expect(productionStatusLabel("exception")).toBe("Faltante");
    expect(productionStatusLabel("cancelled")).toBe("Cancelado");
    expect(productionStatusLabel("replaced")).toBe("Reemplazado");
  });

  it("offers exactly one forward step per item state", () => {
    expect(nextProductionStep("queued")).toEqual({
      label: "Empezar a preparar",
      target: "preparing"
    });
    expect(nextProductionStep("preparing")).toEqual({
      label: "Marcar listo",
      target: "ready"
    });
    expect(nextProductionStep("ready")).toBeNull();
    for (const status of [
      "delivered",
      "exception",
      "cancelled",
      "replaced"
    ] as const) {
      expect(nextProductionStep(status)).toBeNull();
    }
  });

  it("keeps active tickets before ready ones, oldest first", () => {
    const sorted = sortProductionTickets([
      ticket("c", "ready", "2026-10-24T10:00:00.000Z"),
      ticket("b", "queued", "2026-10-24T10:05:00.000Z"),
      ticket("a", "in_preparation", "2026-10-24T10:01:00.000Z")
    ]);
    expect(sorted.map(({ orderId }) => orderId)).toEqual(["a", "b", "c"]);
  });
});
