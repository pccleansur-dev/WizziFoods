import { describe, expect, it, vi } from "vitest";

import { TableEntryService } from "./table-entry.service.js";

const token = "ab".repeat(32);
const context = {
  domain: { hostname: "bar.example.com", id: "d" },
  location: { id: "a8000000-0000-4000-8000-000000000008", name: "Bar" },
  tenant: { id: "a3000000-0000-4000-8000-000000000003", name: "Bar", slug: "b" }
} as never;

function entry(overrides: Record<string, unknown> = {}) {
  return {
    acceptsNewTables: true,
    floorName: "Terraza",
    group: null,
    label: "5",
    published: true,
    sectorName: "Salón",
    serviceState: "available",
    tableId: "a2000000-0000-4000-8000-000000000002",
    ...overrides
  };
}

async function outcome(row: unknown) {
  const resolveTableEntry = vi.fn().mockResolvedValue(row);
  const result = await new TableEntryService({
    resolveTableEntry
  } as never).resolve(context, token);
  return { resolveTableEntry, result };
}

describe("TableEntryService", () => {
  it("lets a diner start the flow on an available table", async () => {
    const { result, resolveTableEntry } = await outcome(entry());
    expect(result).toEqual({
      entry: {
        canCallWaiter: true,
        canConfirmOrder: true,
        group: null,
        mode: "start",
        reason: null,
        table: { floorName: "Terraza", label: "5", sectorName: "Salón" }
      },
      status: "ok"
    });
    expect(resolveTableEntry).toHaveBeenCalledWith(
      {
        locationId: "a8000000-0000-4000-8000-000000000008",
        tenantId: "a3000000-0000-4000-8000-000000000003"
      },
      token
    );
  });

  it("joins the session of an occupied table, even while the business is closing tables", async () => {
    const { result } = await outcome(
      entry({ acceptsNewTables: false, serviceState: "occupied" })
    );
    expect(result).toMatchObject({
      entry: { canConfirmOrder: true, mode: "join", reason: null },
      status: "ok"
    });
  });

  it.each([
    ["needs_cleaning", "needs_cleaning"],
    ["out_of_service", "out_of_service"]
  ])(
    "only shows the menu and calls the waiter when the table is %s",
    async (serviceState, reason) => {
      const { result } = await outcome(entry({ serviceState }));
      expect(result).toMatchObject({
        entry: {
          canCallWaiter: true,
          canConfirmOrder: false,
          mode: "view_only",
          reason
        },
        status: "ok"
      });
    }
  );

  it("keeps the waiter call of a seated table while the business is closing tables", async () => {
    const { result } = await outcome(
      entry({ acceptsNewTables: false, serviceState: "occupied" })
    );
    expect(result).toMatchObject({ entry: { canCallWaiter: true } });
  });

  it.each(["available", "needs_cleaning", "out_of_service"])(
    "takes no waiter call from a %s table while the business is closing tables",
    async (serviceState) => {
      const { result } = await outcome(
        entry({ acceptsNewTables: false, serviceState })
      );
      expect(result).toMatchObject({
        entry: { canCallWaiter: false, mode: "view_only" },
        status: "ok"
      });
    }
  );

  it("does not open new tables while the business is closing them", async () => {
    const { result } = await outcome(entry({ acceptsNewTables: false }));
    expect(result).toMatchObject({
      entry: {
        canCallWaiter: false,
        canConfirmOrder: false,
        mode: "view_only",
        reason: "not_accepting"
      },
      status: "ok"
    });
  });

  it("says the business is not open before it is published", async () => {
    const { result } = await outcome(entry({ published: false }));
    expect(result).toEqual({ status: "unavailable" });
  });

  it("describes the group so every table of it reaches the same party", async () => {
    const { result } = await outcome(
      entry({
        group: { id: "g", name: "Cumpleaños", tableLabels: ["17", "18"] },
        serviceState: "occupied"
      })
    );
    expect(result).toMatchObject({
      entry: { group: { name: "Cumpleaños", tableLabels: ["17", "18"] } }
    });
  });

  it("never returns the token or any internal id", async () => {
    const { result } = await outcome(entry());
    const text = JSON.stringify(result);
    expect(text).not.toContain(token);
    expect(text).not.toContain("a2000000");
  });

  it("answers invalid for an unknown token and for a malformed one alike", async () => {
    const { result } = await outcome(null);
    expect(result).toEqual({ status: "invalid" });
  });
});
