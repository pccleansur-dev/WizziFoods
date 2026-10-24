import { describe, expect, it } from "vitest";

import {
  FLOOR_PLAN_LIMITS,
  parseFloorPlanCommand,
  parseFloorPlanDraft,
  type FloorPlanDraft
} from "./floor-plan.js";

const sectorId = "f1000000-0000-4000-8000-000000000001";
const floorId = "fa000000-0000-4000-8000-00000000000a";
const upperFloorId = "fb000000-0000-4000-8000-00000000000b";
const tableA = "f2000000-0000-4000-8000-000000000002";
const tableB = "f3000000-0000-4000-8000-000000000003";
const groupId = "f4000000-0000-4000-8000-000000000004";
const commandId = "f5000000-0000-4000-8000-000000000005";

function validPlan(): FloorPlanDraft {
  return {
    floors: [
      { id: floorId, name: "Planta baja", position: 0, shortName: "PB" }
    ],
    groups: [{ id: groupId, name: "Familia", tableIds: [tableA, tableB] }],
    sectors: [{ id: sectorId, name: "Salón", position: 0 }],
    tables: [
      {
        height: 100,
        id: tableA,
        floorId,
        label: "1",
        rotation: 0,
        seatCount: 4,
        seatLayout: "perimeter",
        sectorId,
        shape: "square",
        width: 100,
        x: 40,
        y: 40
      },
      {
        height: 80,
        id: tableB,
        floorId,
        label: "2",
        rotation: 90,
        seatCount: 6,
        seatLayout: "long-sides",
        sectorId,
        shape: "rectangle",
        width: 160,
        x: 200,
        y: 40
      }
    ]
  };
}

function issueCodes(input: unknown): string[] {
  const result = parseFloorPlanDraft(input);
  return result.ok ? [] : result.issues.map(({ code }) => code);
}

describe("parseFloorPlanDraft", () => {
  it("accepts a canonical plan and restores it exactly after serialization", () => {
    const plan = validPlan();
    const result = parseFloorPlanDraft(JSON.parse(JSON.stringify(plan)));
    expect(result).toEqual({ ok: true, plan });
  });

  it("accepts an empty plan so progress can be saved before any table exists", () => {
    expect(
      parseFloorPlanDraft({ floors: [], groups: [], sectors: [], tables: [] })
    ).toMatchObject({ ok: true });
  });

  it("rejects unknown keys, including injected tenant fields", () => {
    const plan = { ...validPlan(), tenantId: "x" };
    expect(issueCodes(plan)).toContain("INVALID_STRUCTURE");
    const table = { ...validPlan().tables[0], locationId: "x" };
    expect(
      issueCodes({ ...validPlan(), tables: [table, validPlan().tables[1]] })
    ).toContain("INVALID_STRUCTURE");
  });

  it("rejects geometry outside the canvas and impossible sizes", () => {
    const base = validPlan();
    const withTable = (patch: object) => ({
      ...base,
      tables: [{ ...base.tables[0], ...patch }, base.tables[1]]
    });
    expect(issueCodes(withTable({ x: -1 }))).toContain("OUT_OF_BOUNDS");
    expect(
      issueCodes(withTable({ x: FLOOR_PLAN_LIMITS.canvasWidth }))
    ).toContain("OUT_OF_BOUNDS");
    expect(issueCodes(withTable({ width: 10, height: 10 }))).toContain(
      "INVALID_DIMENSIONS"
    );
    expect(issueCodes(withTable({ x: 1.5 }))).toContain("INVALID_FIELD");
    expect(issueCodes(withTable({ x: Number.NaN }))).toContain("INVALID_FIELD");
    expect(issueCodes(withTable({ rotation: 360 }))).toContain("INVALID_FIELD");
    expect(issueCodes(withTable({ seatCount: 25 }))).toContain("INVALID_FIELD");
    expect(issueCodes(withTable({ shape: "hexagon" }))).toContain(
      "INVALID_FIELD"
    );
  });

  it("requires equal sides for round and square tables", () => {
    const base = validPlan();
    const table = { ...base.tables[0], shape: "round", width: 100, height: 90 };
    expect(issueCodes({ ...base, tables: [table, base.tables[1]] })).toContain(
      "INVALID_DIMENSIONS"
    );
  });

  it("rejects duplicate ids, duplicate labels and unknown sectors", () => {
    const base = validPlan();
    const dupId = { ...base.tables[1], id: tableA };
    expect(issueCodes({ ...base, tables: [base.tables[0], dupId] })).toContain(
      "DUPLICATE_ID"
    );
    const dupLabel = { ...base.tables[1], label: " 1".trim() };
    expect(
      issueCodes({ ...base, tables: [base.tables[0], dupLabel] })
    ).toContain("DUPLICATE_LABEL");
    const orphan = { ...base.tables[1], sectorId: tableB };
    expect(issueCodes({ ...base, tables: [base.tables[0], orphan] })).toContain(
      "UNKNOWN_SECTOR"
    );
  });

  it("treats labels as case-insensitive duplicates", () => {
    const base = validPlan();
    const a = { ...base.tables[0], label: "Barra" };
    const b = { ...base.tables[1], label: "barra" };
    expect(issueCodes({ ...base, tables: [a, b] })).toContain(
      "DUPLICATE_LABEL"
    );
  });

  it("validates groups without touching physical identity", () => {
    const base = validPlan();
    expect(
      issueCodes({
        ...base,
        groups: [{ id: groupId, name: "Solo", tableIds: [tableA] }]
      })
    ).toContain("INVALID_GROUP");
    expect(
      issueCodes({
        ...base,
        groups: [
          { id: groupId, name: "A", tableIds: [tableA, tableB] },
          {
            id: "f6000000-0000-4000-8000-000000000006",
            name: "B",
            tableIds: [tableB, tableA]
          }
        ]
      })
    ).toContain("INVALID_GROUP");
    expect(
      issueCodes({
        ...base,
        groups: [
          {
            id: groupId,
            name: "A",
            tableIds: [tableA, "f7000000-0000-4000-8000-000000000007"]
          }
        ]
      })
    ).toContain("INVALID_GROUP");
  });

  it("reports every problem with a path so the editor can point to it", () => {
    const base = validPlan();
    const result = parseFloorPlanDraft({
      ...base,
      tables: [
        { ...base.tables[0], x: -5 },
        { ...base.tables[1], y: -5 }
      ]
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map(({ path }) => path)).toEqual([
        "tables[0].x",
        "tables[1].y"
      ]);
      expect(result.issues[0]?.message).toMatch(/plano/u);
    }
  });

  it("enforces collection limits", () => {
    const base = validPlan();
    const sectors = Array.from(
      { length: FLOOR_PLAN_LIMITS.maxSectors + 1 },
      (_, index) => ({
        id: `f8000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `S${index}`,
        position: index
      })
    );
    expect(issueCodes({ ...base, sectors })).toContain("LIMIT_EXCEEDED");
  });

  it("rejects non-canonical text", () => {
    const base = validPlan();
    const table = { ...base.tables[0], label: " 1 " };
    expect(issueCodes({ ...base, tables: [table, base.tables[1]] })).toContain(
      "INVALID_FIELD"
    );
    expect(
      issueCodes({
        ...base,
        sectors: [{ id: sectorId, name: "", position: 0 }]
      })
    ).toContain("INVALID_FIELD");
  });
});

describe("floors (plantas)", () => {
  const upper = {
    id: upperFloorId,
    name: "Planta alta",
    position: 1,
    shortName: null
  };

  it("accepts several floors and tables on each of them", () => {
    const base = validPlan();
    const plan = {
      ...base,
      floors: [...base.floors, upper],
      groups: [],
      tables: [base.tables[0], { ...base.tables[1], floorId: upperFloorId }]
    };
    expect(parseFloorPlanDraft(plan)).toMatchObject({ ok: true });
  });

  it("rejects a table on a floor that does not exist", () => {
    const base = validPlan();
    const orphan = { ...base.tables[1], floorId: upperFloorId };
    expect(issueCodes({ ...base, tables: [base.tables[0], orphan] })).toContain(
      "UNKNOWN_FLOOR"
    );
  });

  it("keeps every table of a group on the same floor", () => {
    const base = validPlan();
    const plan = {
      ...base,
      floors: [...base.floors, upper],
      tables: [base.tables[0], { ...base.tables[1], floorId: upperFloorId }]
    };
    expect(issueCodes(plan)).toContain("MIXED_FLOORS");
  });

  it("rejects repeated floor ids and repeated names, ignoring case", () => {
    const base = validPlan();
    expect(
      issueCodes({
        ...base,
        floors: [...base.floors, { ...upper, id: floorId }]
      })
    ).toContain("DUPLICATE_ID");
    expect(
      issueCodes({
        ...base,
        floors: [...base.floors, { ...upper, name: "planta BAJA" }]
      })
    ).toContain("DUPLICATE_LABEL");
  });

  it("validates names, the optional short name and the amount of floors", () => {
    const base = validPlan();
    for (const floor of [
      { ...upper, name: "" },
      { ...upper, name: " Alta " },
      { ...upper, shortName: "" },
      {
        ...upper,
        shortName: "x".repeat(FLOOR_PLAN_LIMITS.maxShortNameLength + 1)
      },
      { ...upper, position: -1 },
      { ...upper, extra: 1 }
    ]) {
      expect(
        issueCodes({ ...base, floors: [...base.floors, floor] })
      ).not.toEqual([]);
    }
    const many = Array.from(
      { length: FLOOR_PLAN_LIMITS.maxFloors + 1 },
      (_, n) => ({
        id: `fc000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        name: `Planta ${n}`,
        position: n,
        shortName: null
      })
    );
    expect(
      issueCodes({ ...base, floors: many, groups: [], tables: [] })
    ).toContain("LIMIT_EXCEEDED");
  });

  it("requires the floors list and the floor of each table", () => {
    const withoutFloors: Record<string, unknown> = { ...validPlan() };
    delete withoutFloors.floors;
    expect(issueCodes(withoutFloors)).toContain("INVALID_STRUCTURE");
    const base = validPlan();
    const bare: Record<string, unknown> = { ...base.tables[0] };
    delete bare.floorId;
    expect(issueCodes({ ...base, tables: [bare, base.tables[1]] })).toContain(
      "INVALID_STRUCTURE"
    );
  });
});

describe("parseFloorPlanCommand", () => {
  it("accepts exactly commandId, expectedVersion and plan", () => {
    const body = { commandId, expectedVersion: 0, plan: validPlan() };
    expect(parseFloorPlanCommand(body)).toEqual({ ok: true, command: body });
  });

  it("rejects injected tenant or location fields and malformed versions", () => {
    const plan = validPlan();
    for (const body of [
      { commandId, expectedVersion: 0, plan, tenantId: "x" },
      { commandId, expectedVersion: 0, plan, locationId: "x" },
      { commandId, expectedVersion: -1, plan },
      { commandId, expectedVersion: 1.5, plan },
      { commandId: "not-a-uuid", expectedVersion: 0, plan },
      { expectedVersion: 0, plan }
    ]) {
      expect(parseFloorPlanCommand(body).ok).toBe(false);
    }
  });

  it("surfaces plan issues with a plan. path prefix", () => {
    const plan = validPlan();
    const result = parseFloorPlanCommand({
      commandId,
      expectedVersion: 0,
      plan: { ...plan, tables: [{ ...plan.tables[0], x: -1 }] }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe("plan.tables[0].x");
  });
});
