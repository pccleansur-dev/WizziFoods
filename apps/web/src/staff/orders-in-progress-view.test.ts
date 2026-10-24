import type { WaiterInProgressItem } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  attentionCount,
  differenceLabel,
  itemActions,
  orderStatusSummary
} from "./orders-in-progress-view";

const plain = (text: string) => text.replace(/ /gu, " ");

function item(
  status: WaiterInProgressItem["status"],
  adjustment: WaiterInProgressItem["adjustment"] = null
): WaiterInProgressItem {
  return {
    adjustment,
    exceptionReason: null,
    lineId: "11111111-1111-4111-8111-111111111111",
    quantity: 1,
    sector: "kitchen",
    status,
    title: "Milanesa",
    totalCents: 100,
    unitPriceCents: 100,
    variantTitle: null
  };
}

const proposal = {
  differenceCents: 2900,
  id: "22222222-2222-4222-8222-222222222222",
  kind: "replacement" as const,
  replacementTitle: "Vino",
  status: "proposed" as const
};

describe("item actions for the waiter", () => {
  it("lets the waiter deliver only a ready item", () => {
    expect(itemActions(item("ready"), false)).toEqual(["deliver"]);
    for (const status of [
      "queued",
      "preparing",
      "delivered",
      "cancelled",
      "replaced"
    ] as const) {
      expect(itemActions(item(status), false)).not.toContain("deliver");
    }
  });

  it("offers a replacement for a shortage, then the decision once it is proposed", () => {
    expect(itemActions(item("exception"), false)).toEqual(["propose"]);
    expect(itemActions(item("exception", proposal), false)).toEqual(["decide"]);
    expect(
      itemActions(item("exception", { ...proposal, status: "rejected" }), false)
    ).toEqual(["propose"]);
  });

  it("gives cancelling only to a manager and only before the item is ready", () => {
    expect(itemActions(item("queued"), true)).toEqual(["cancel"]);
    expect(itemActions(item("preparing"), true)).toEqual(["cancel"]);
    expect(itemActions(item("exception"), true)).toEqual(["propose", "cancel"]);
    expect(itemActions(item("ready"), true)).toEqual(["deliver"]);
    expect(itemActions(item("queued"), false)).toEqual([]);
    expect(itemActions(item("delivered"), true)).toEqual([]);
  });
});

describe("order summaries", () => {
  it("labels the economic difference without ambiguity", () => {
    expect(plain(differenceLabel(2900))).toBe("Suma $ 29,00");
    expect(plain(differenceLabel(-9000))).toBe("Resta $ 90,00");
    expect(plain(differenceLabel(0))).toBe("Sin diferencia de precio");
  });

  it("counts the items that need the waiter", () => {
    expect(
      attentionCount([
        item("ready"),
        item("exception"),
        item("queued"),
        item("exception", proposal)
      ])
    ).toBe(3);
  });

  it("summarizes an order in the operators' words", () => {
    expect(orderStatusSummary("exception")).toBe("Hay un faltante");
    expect(orderStatusSummary("ready")).toBe("Listo para entregar");
    expect(orderStatusSummary("in_preparation")).toBe("En preparación");
    expect(orderStatusSummary("queued")).toBe("En cola");
    expect(orderStatusSummary("delivered")).toBe("Entregado");
    expect(orderStatusSummary("cancelled")).toBe("Cancelado");
  });
});
