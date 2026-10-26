import type { WaiterSalonUnit } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  anchorChoices,
  canSeparate,
  joinBlockedReason,
  joinSummary,
  joinTableIds,
  separateSummary
} from "./regroup-view";

function unit(overrides: Partial<WaiterSalonUnit> = {}): WaiterSalonUnit {
  return {
    balanceCents: null,
    floorId: "floor-1",
    id: "unit-1",
    kind: "table",
    label: "Mesa 1",
    name: null,
    openCalls: 0,
    pendingIntents: 0,
    sectorName: "Salón",
    session: null,
    state: "available",
    tables: [{ id: "table-1", inScope: true, label: "1" }],
    ...overrides
  };
}

const two = unit({
  id: "unit-2",
  label: "Mesa 2",
  tables: [{ id: "table-2", inScope: true, label: "2" }]
});
const group = unit({
  id: "group-1",
  kind: "group",
  label: "Mesas 3 + 4",
  name: "Cumple",
  session: { id: "session-1" },
  state: "occupied",
  tables: [
    { id: "table-3", inScope: true, label: "3" },
    { id: "table-4", inScope: true, label: "4" }
  ]
});

describe("regroup view", () => {
  it("lets the first unit be picked and ties the rest to its floor", () => {
    expect(joinBlockedReason(unit(), [])).toBeNull();
    expect(joinBlockedReason(two, [unit()])).toBeNull();
    expect(
      joinBlockedReason(unit({ floorId: "floor-2", id: "far" }), [unit()])
    ).toMatch(/otra planta/u);
  });

  it("does not offer a table that waits for cleaning or is out of service", () => {
    expect(joinBlockedReason(unit({ state: "needs_cleaning" }), [])).toMatch(
      /limpieza/u
    );
    expect(joinBlockedReason(unit({ state: "out_of_service" }), [])).toMatch(
      /fuera de servicio/u
    );
  });

  it("never mixes two accounts that are open", () => {
    const busy = unit({ id: "busy", session: { id: "s1" } });
    const other = unit({ id: "other", session: { id: "s2" } });
    expect(joinBlockedReason(other, [busy])).toMatch(/cuenta abierta/u);
    expect(joinBlockedReason(two, [busy])).toBeNull();
  });

  it("needs every table of a group to be in the waiter's zone", () => {
    const partial = unit({
      id: "partial",
      kind: "group",
      tables: [
        { id: "a", inScope: true, label: "7" },
        { id: "b", inScope: false, label: "8" }
      ]
    });
    expect(joinBlockedReason(partial, [])).toMatch(/otro sector/u);
    expect(canSeparate(partial)).toBe(false);
    expect(canSeparate(group)).toBe(true);
    expect(canSeparate(unit())).toBe(false);
  });

  it("sends one table per unit and lets the server expand a group", () => {
    expect(joinTableIds([unit(), two, group])).toEqual([
      "table-1",
      "table-2",
      "table-3"
    ]);
  });

  it("summarises what will be joined and what separating does", () => {
    expect(joinSummary([unit(), two])).toBe("Mesas 1 + 2");
    expect(joinSummary([unit(), group])).toBe("Mesas 1 + 3 + 4");
    expect(separateSummary(group, "table-4")).toMatch(
      /cuenta abierta queda en la mesa 4/u
    );
    expect(separateSummary(group, "table-4")).toMatch(/no se mueve/u);
    expect(separateSummary(unit({ ...group, session: null }), null)).toMatch(
      /Sin cuenta abierta/u
    );
  });

  it("offers the tables of a group as the anchor only while an account is open", () => {
    expect(anchorChoices(group)).toEqual([
      { id: "table-3", label: "3" },
      { id: "table-4", label: "4" }
    ]);
    expect(anchorChoices({ ...group, session: null })).toEqual([]);
  });
});
