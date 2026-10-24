import {
  FLOOR_PLAN_LIMITS,
  parseFloorPlanDraft,
  type FloorPlanDraft
} from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  addSector,
  addTable,
  createEmptyFloorPlan,
  groupTables,
  moveTable,
  nudgeTable,
  planIsDirty,
  removeSector,
  removeTable,
  resizeTable,
  rotateTable,
  seatPositions,
  tableLabelForIssue,
  ungroupTables,
  updateTable
} from "./floor-plan-editor-state";

const ids = (() => {
  let counter = 0;
  return () => `a0000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
})();

function planWithTables(count = 3): FloorPlanDraft {
  let plan = addSector(createEmptyFloorPlan(), "Salón", ids());
  const sectorId = plan.sectors[0]!.id;
  for (let index = 0; index < count; index += 1) {
    plan = addTable(plan, { id: ids(), sectorId, shape: "square" });
  }
  return plan;
}

describe("floor plan editor state", () => {
  it("creates sectors and rejects blank or surplus ones", () => {
    const plan = addSector(createEmptyFloorPlan(), "  Terraza ", ids());
    expect(plan.sectors).toEqual([
      { id: expect.any(String), name: "Terraza", position: 0 }
    ]);
    expect(addSector(plan, "   ", ids())).toBe(plan);
    let full = createEmptyFloorPlan();
    for (let index = 0; index < FLOOR_PLAN_LIMITS.maxSectors + 2; index += 1) {
      full = addSector(full, `S${index}`, ids());
    }
    expect(full.sectors).toHaveLength(FLOOR_PLAN_LIMITS.maxSectors);
  });

  it("adds tables with the next free label, inside the canvas and valid", () => {
    const plan = planWithTables(4);
    expect(plan.tables.map(({ label }) => label)).toEqual(["1", "2", "3", "4"]);
    const first = plan.tables[0]!;
    const positions = new Set(plan.tables.map(({ x, y }) => `${x},${y}`));
    expect(positions.size).toBe(4);
    expect(first.shape).toBe("square");
    expect(parseFloorPlanDraft(plan).ok).toBe(true);
  });

  it("fills the first free label when one was removed", () => {
    let plan = planWithTables(3);
    plan = removeTable(plan, plan.tables[1]!.id);
    plan = addTable(plan, {
      id: ids(),
      sectorId: plan.sectors[0]!.id,
      shape: "round"
    });
    expect(plan.tables.map(({ label }) => label)).toEqual(["1", "3", "2"]);
    expect(plan.tables[2]!.width).toBe(plan.tables[2]!.height);
  });

  it("moves a table keeping its identity and clamping to the canvas", () => {
    const plan = planWithTables(1);
    const table = plan.tables[0]!;
    const moved = moveTable(plan, table.id, 500, 700);
    expect(moved.tables[0]).toMatchObject({
      id: table.id,
      label: table.label,
      x: 500,
      y: 700
    });
    const clamped = moveTable(plan, table.id, 99_999, -50);
    expect(clamped.tables[0]!.x).toBe(
      FLOOR_PLAN_LIMITS.canvasWidth - table.width
    );
    expect(clamped.tables[0]!.y).toBe(0);
    expect(parseFloorPlanDraft(clamped).ok).toBe(true);
  });

  it("nudges with arrow steps and never leaves the plan", () => {
    const base = planWithTables(1);
    const plan = moveTable(base, base.tables[0]!.id, 0, 0);
    const id = plan.tables[0]!.id;
    expect(nudgeTable(plan, id, -10, -10).tables[0]).toMatchObject({
      x: 0,
      y: 0
    });
    expect(nudgeTable(plan, id, 10, 20).tables[0]).toMatchObject({
      x: 10,
      y: 20
    });
  });

  it("resizes keeping round and square tables proportional", () => {
    const plan = planWithTables(1);
    const id = plan.tables[0]!.id;
    const resized = resizeTable(plan, id, 200, 120);
    expect(resized.tables[0]!.width).toBe(resized.tables[0]!.height);
    const rectangle = updateTable(plan, id, { shape: "rectangle" });
    const wide = resizeTable(rectangle, id, 240, 100);
    expect(wide.tables[0]).toMatchObject({ height: 100, width: 240 });
    expect(parseFloorPlanDraft(wide).ok).toBe(true);
  });

  it("converts a rectangle into a square without breaking validity", () => {
    const plan = planWithTables(1);
    const id = plan.tables[0]!.id;
    const rectangle = resizeTable(
      updateTable(plan, id, { shape: "rectangle" }),
      id,
      240,
      100
    );
    const square = updateTable(rectangle, id, { shape: "square" });
    expect(square.tables[0]!.width).toBe(square.tables[0]!.height);
    expect(parseFloorPlanDraft(square).ok).toBe(true);
  });

  it("groups and separates tables without replacing any physical identity", () => {
    const plan = planWithTables(3);
    const [a, b, c] = plan.tables;
    const before = plan.tables.map(({ id, label }) => [id, label]);
    const grouped = groupTables(plan, [a!.id, b!.id], ids(), "Familia");
    expect(grouped.groups).toEqual([
      { id: expect.any(String), name: "Familia", tableIds: [a!.id, b!.id] }
    ]);
    expect(grouped.tables.map(({ id, label }) => [id, label])).toEqual(before);
    expect(groupTables(grouped, [b!.id, c!.id], ids(), "Otra")).toBe(grouped);
    expect(groupTables(plan, [a!.id], ids(), "Sola")).toBe(plan);
    const separated = ungroupTables(grouped, grouped.groups[0]!.id);
    expect(separated.groups).toEqual([]);
    expect(separated.tables).toEqual(plan.tables);
  });

  it("dissolves a group that would be left with one table", () => {
    const plan = planWithTables(3);
    const [a, b, c] = plan.tables;
    const grouped = groupTables(
      plan,
      [a!.id, b!.id, c!.id],
      ids(),
      "Mesa larga"
    );
    const smaller = removeTable(grouped, c!.id);
    expect(smaller.groups[0]!.tableIds).toEqual([a!.id, b!.id]);
    expect(removeTable(smaller, b!.id).groups).toEqual([]);
  });

  it("only removes empty sectors", () => {
    const plan = planWithTables(1);
    const sectorId = plan.sectors[0]!.id;
    expect(removeSector(plan, sectorId)).toBe(plan);
    const empty = removeTable(plan, plan.tables[0]!.id);
    expect(removeSector(empty, sectorId).sectors).toEqual([]);
  });

  it("detects unsaved changes regardless of key order", () => {
    const plan = planWithTables(1);
    expect(planIsDirty(plan, JSON.parse(JSON.stringify(plan)))).toBe(false);
    expect(planIsDirty(moveTable(plan, plan.tables[0]!.id, 90, 90), plan)).toBe(
      true
    );
  });

  it("places seats around each table according to the layout", () => {
    const plan = planWithTables(1);
    const id = plan.tables[0]!.id;
    const table = (
      layout: "long-sides" | "one-side" | "perimeter",
      count: number
    ) =>
      updateTable(plan, id, { seatCount: count, seatLayout: layout })
        .tables[0]!;
    expect(seatPositions(table("perimeter", 4))).toHaveLength(4);
    expect(seatPositions(table("perimeter", 0))).toEqual([]);
    const oneSide = seatPositions(table("one-side", 3));
    expect(new Set(oneSide.map(({ y }) => y)).size).toBe(1);
    const sides = seatPositions(table("long-sides", 4));
    expect(sides.filter(({ y }) => y < 0)).toHaveLength(2);
    expect(sides.filter(({ y }) => y > 0)).toHaveLength(2);
  });

  it("maps an issue path to the table label it affects", () => {
    const plan = planWithTables(2);
    expect(tableLabelForIssue(plan, "tables[1].x")).toBe("2");
    expect(tableLabelForIssue(plan, "sectors[0].name")).toBeNull();
  });
});

describe("seats around a rectangular table", () => {
  const sidesOf = (
    seats: { x: number; y: number }[],
    width: number,
    height: number
  ) => ({
    bottom: seats.filter(({ y }) => y > height / 2).length,
    left: seats.filter(
      ({ x, y }) => x < -width / 2 && Math.abs(y) <= height / 2
    ).length,
    right: seats.filter(
      ({ x, y }) => x > width / 2 && Math.abs(y) <= height / 2
    ).length,
    top: seats.filter(({ y }) => y < -height / 2).length
  });
  const tableOf = (width: number, height: number, seatCount: number) => ({
    height,
    seatCount,
    seatLayout: "perimeter" as const,
    shape: "rectangle" as const,
    width
  });

  it("puts one seat on each short end and the rest on the long sides", () => {
    const seats = seatPositions(tableOf(160, 90, 8));
    expect(seats).toHaveLength(8);
    expect(sidesOf(seats, 160, 90)).toEqual({
      bottom: 3,
      left: 1,
      right: 1,
      top: 3
    });
  });

  it("follows the long side when the table is taller than wide", () => {
    const seats = seatPositions(tableOf(90, 160, 8));
    expect(sidesOf(seats, 90, 160)).toEqual({
      bottom: 1,
      left: 3,
      right: 3,
      top: 1
    });
  });

  it("spreads seats evenly around a square table", () => {
    const seats = seatPositions(tableOf(100, 100, 8));
    expect(sidesOf(seats, 100, 100)).toEqual({
      bottom: 2,
      left: 2,
      right: 2,
      top: 2
    });
  });

  it("keeps every seat count and never stacks two seats on the same spot", () => {
    for (const [width, height] of [
      [160, 90],
      [100, 100],
      [90, 160]
    ] as const) {
      for (let count = 1; count <= 24; count += 1) {
        const seats = seatPositions(tableOf(width, height, count));
        expect(seats).toHaveLength(count);
        expect(new Set(seats.map(({ x, y }) => `${x},${y}`)).size).toBe(count);
      }
    }
  });
});

describe("rotating a table by quarter turns", () => {
  it("adds 90 degrees and wraps around", () => {
    let plan = planWithTables(1);
    const id = plan.tables[0]!.id;
    for (const expected of [90, 180, 270, 0]) {
      plan = rotateTable(plan, id, 90);
      expect(plan.tables[0]?.rotation).toBe(expected);
    }
    expect(rotateTable(plan, id, -90).tables[0]?.rotation).toBe(270);
  });
});
