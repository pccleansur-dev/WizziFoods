import { describe, expect, it } from "vitest";

import { parseTableEntryResponse } from "./table-entry";

const entry = {
  canCallWaiter: true,
  canConfirmOrder: true,
  group: null,
  mode: "start",
  reason: null,
  table: { floorName: "Terraza", label: "5", sectorName: "Salón" }
};

describe("parseTableEntryResponse", () => {
  it("accepts a valid entry", () => {
    expect(parseTableEntryResponse({ data: { entry, status: "ok" } })).toEqual({
      entry,
      status: "ok"
    });
  });

  it("keeps the group of a grouped table", () => {
    const grouped = {
      ...entry,
      group: { name: "Cumpleaños", tableLabels: ["17", "18"] },
      mode: "join"
    };
    expect(
      parseTableEntryResponse({ data: { entry: grouped, status: "ok" } })
    ).toEqual({ entry: grouped, status: "ok" });
  });

  it.each(["invalid", "unavailable"])("passes through %s", (status) => {
    expect(parseTableEntryResponse({ data: { status } })).toEqual({ status });
  });

  it.each([
    null,
    {},
    { data: { status: "ok" } },
    { data: { entry: { ...entry, mode: "other" }, status: "ok" } },
    { data: { entry: { ...entry, reason: "x" }, status: "ok" } },
    { data: { entry: { ...entry, table: {} }, status: "ok" } },
    { data: { entry: { ...entry, group: { name: "" } }, status: "ok" } },
    { data: { status: "surprise" } }
  ])("treats an unexpected answer as an error: %j", (body) => {
    expect(parseTableEntryResponse(body)).toEqual({ status: "error" });
  });
});
