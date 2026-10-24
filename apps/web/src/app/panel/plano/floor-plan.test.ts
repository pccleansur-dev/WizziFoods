import { describe, expect, it } from "vitest";

import {
  parseFloorPlanQrResponse,
  parseFloorPlanResponse,
  parseFloorPlanSaveResponse
} from "./floor-plan";

const empty = { groups: [], sectors: [], tables: [] };
const tableId = "a2000000-0000-4000-8000-000000000002";

describe("floor plan responses", () => {
  it("accepts a canonical plan", () => {
    expect(
      parseFloorPlanResponse({ data: { plan: empty, version: 0 } })
    ).toEqual({ plan: empty, version: 0 });
  });

  it("rejects extra envelope keys and non-canonical plans", () => {
    expect(() =>
      parseFloorPlanResponse({ data: { plan: empty, version: 0 }, extra: 1 })
    ).toThrow();
    expect(() =>
      parseFloorPlanResponse({
        data: { plan: { ...empty, tenantId: "x" }, version: 0 }
      })
    ).toThrow();
    expect(() =>
      parseFloorPlanResponse({ data: { plan: empty, version: -1 } })
    ).toThrow();
  });

  it("requires the applied flag on save responses", () => {
    expect(
      parseFloorPlanSaveResponse({
        data: { applied: false, plan: empty, version: 3 }
      })
    ).toMatchObject({ applied: false, version: 3 });
    expect(() =>
      parseFloorPlanSaveResponse({ data: { plan: empty, version: 3 } })
    ).toThrow();
  });

  it("validates QR downloads", () => {
    const item = {
      label: "1",
      svg: "<svg></svg>",
      tableId,
      url: "https://x.example/m/abc"
    };
    expect(parseFloorPlanQrResponse({ data: [item] })).toEqual([item]);
    expect(() =>
      parseFloorPlanQrResponse({ data: [{ ...item, svg: "<img>" }] })
    ).toThrow();
    expect(() =>
      parseFloorPlanQrResponse({ data: [{ ...item, token: "secret" }] })
    ).toThrow();
  });
});
