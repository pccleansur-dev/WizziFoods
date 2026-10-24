import type { WaiterSalonUnit, WaiterSalonView } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  buildWaiterMenu,
  callAgeLabel,
  groupUnitsByFloor,
  paymentMethodLabel,
  tableStateLabel,
  waiterErrorCode,
  waiterErrorMessage
} from "./waiter-view";

const floorA = "11111111-1111-4111-8111-111111111111";
const floorB = "22222222-2222-4222-8222-222222222222";

function unit(
  id: string,
  label: string,
  floorId: string,
  openCalls = 0
): WaiterSalonUnit {
  return {
    balanceCents: null,
    floorId,
    id,
    kind: "table",
    label,
    name: null,
    openCalls,
    pendingIntents: 0,
    sectorName: "Salón",
    session: null,
    state: "available",
    tables: [{ id, inScope: true, label }]
  };
}

const view: WaiterSalonView = {
  calls: [],
  floors: [
    { id: floorA, name: "Planta baja", shortName: "PB" },
    { id: floorB, name: "Terraza", shortName: null }
  ],
  generatedAt: "2026-10-24T12:00:00.000Z",
  intents: [],
  units: [
    unit("a-10", "Mesa 10", floorA),
    unit("a-2", "Mesa 2", floorA),
    unit("a-3", "Mesa 3", floorA, 1),
    unit("b-1", "Mesa 1", floorB)
  ]
};

describe("waiter salon view helpers", () => {
  it("groups units by floor, urgent tables first and numbers in natural order", () => {
    const groups = groupUnitsByFloor(view);
    expect(groups.map((group) => group.floor.name)).toEqual([
      "Planta baja",
      "Terraza"
    ]);
    expect(groups[0]!.units.map((entry) => entry.label)).toEqual([
      "Mesa 3",
      "Mesa 2",
      "Mesa 10"
    ]);
  });

  it("omits floors without visible tables", () => {
    expect(
      groupUnitsByFloor({ ...view, units: [unit("b-1", "Mesa 1", floorB)] })
    ).toHaveLength(1);
  });

  it("labels states and in-person payment methods in Spanish", () => {
    expect(tableStateLabel("needs_cleaning")).toBe("Pendiente de limpieza");
    expect(tableStateLabel("out_of_service")).toBe("Fuera de servicio");
    expect(paymentMethodLabel("credit_card")).toBe("Tarjeta de crédito");
    expect(paymentMethodLabel("other_in_person")).toBe("Otro medio presencial");
  });

  it("describes how long a call has been waiting", () => {
    const now = Date.parse("2026-10-24T12:10:00.000Z");
    expect(callAgeLabel("2026-10-24T12:09:40.000Z", now)).toBe("recién");
    expect(callAgeLabel("2026-10-24T12:07:00.000Z", now)).toBe("hace 3 min");
    expect(callAgeLabel("2026-10-24T10:00:00.000Z", now)).toBe("hace 2 h");
  });

  it("explains known API errors without exposing codes or details", () => {
    expect(waiterErrorMessage("CALL_ALREADY_CLAIMED")).toBe(
      "Otro mozo ya tomó este llamado."
    );
    expect(waiterErrorMessage("INTENT_NOT_CONFIRMABLE")).toContain(
      "pago online"
    );
    expect(waiterErrorMessage("PRODUCTION_TRANSITION_INVALID")).toContain(
      "Actualizá"
    );
    expect(waiterErrorMessage("PRODUCTION_ITEM_NOT_FOUND")).toContain("sector");
    expect(waiterErrorMessage("SOMETHING_ELSE")).toBe(
      "No pudimos completar la operación. Intentá nuevamente."
    );
    expect(waiterErrorCode({ error: { code: "CALL_CLOSED" } })).toBe(
      "CALL_CLOSED"
    );
    expect(waiterErrorCode({ error: "x" })).toBeNull();
  });

  it("builds the manual-order menu from the published catalog, hiding unavailable products", () => {
    const content = (title: string, language = "es") => [
      { description: "", language, title }
    ];
    const menu = buildWaiterMenu(
      {
        baseRevision: null,
        categories: [{ content: content("Platos"), id: "c1", position: 0 }],
        products: [
          {
            categoryId: "c1",
            content: content("Milanesa"),
            id: "p1",
            imageAssetId: null,
            position: 0,
            priceCents: 12_500,
            sectorId: "s1",
            variants: [
              {
                content: content("Napolitana"),
                id: "v1",
                position: 0,
                priceDeltaCents: 2_500
              }
            ]
          },
          {
            categoryId: "c1",
            content: content("Flan", "en"),
            id: "p2",
            imageAssetId: null,
            position: 1,
            priceCents: 5_000,
            sectorId: "s1",
            variants: []
          },
          {
            categoryId: "c1",
            content: content("Agotado"),
            id: "p3",
            imageAssetId: null,
            position: 2,
            priceCents: 100,
            sectorId: "s1",
            variants: []
          }
        ],
        sectors: [{ id: "s1", kind: "kitchen", name: "Cocina", position: 0 }]
      },
      { p3: { isAvailable: false, version: 1 } }
    );
    expect(menu.map((product) => product.title)).toEqual(["Milanesa", "Flan"]);
    expect(menu[0]).toMatchObject({
      categoryTitle: "Platos",
      priceCents: 12_500,
      variants: [{ id: "v1", priceDeltaCents: 2_500, title: "Napolitana" }]
    });
  });
});
