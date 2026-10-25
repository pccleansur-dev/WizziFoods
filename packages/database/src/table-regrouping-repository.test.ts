import { describe, expect, it, vi } from "vitest";

import { createTableRegroupingRepository } from "./table-regrouping-repository.js";

const scope = {
  locationId: "2e000000-0000-4000-8000-000000000001",
  tenantId: "2e000000-0000-4000-8000-000000000002"
};
const staffId = "2e000000-0000-4000-8000-000000000003";
const commandId = "2e000000-0000-4000-8000-000000000004";
const tableA = "2e000000-0000-4000-8000-000000000005";
const tableB = "2e000000-0000-4000-8000-000000000006";
const groupId = "2e000000-0000-4000-8000-000000000007";
const sessionId = "2e000000-0000-4000-8000-000000000008";

function clientReturning(result: unknown) {
  return vi.fn(() => Promise.resolve([{ result }]));
}

function sqlValues(client: ReturnType<typeof vi.fn>): unknown[] {
  return (client.mock.calls[0] as unknown[]).slice(1);
}

const tables = [
  { label: "1", state: "occupied", tableId: tableA },
  { label: "2", state: "occupied", tableId: tableB }
];

describe("table regrouping repository", () => {
  it("joins tables with the canonical scope, a sorted copy of the ids and the name", async () => {
    const client = clientReturning({
      groupId,
      mergedGroupIds: [],
      name: "Cumpleaños",
      sessionId,
      tables
    });
    const result = await createTableRegroupingRepository(
      client as never
    ).joinTables({
      request: { commandId, name: "Cumpleaños", tableIds: [tableB, tableA] },
      scope,
      staffId
    });
    expect(result.groupId).toBe(groupId);
    expect(sqlValues(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      [tableA, tableB],
      "Cumpleaños"
    ]);
  });

  it("separates a group with the anchor table", async () => {
    const client = clientReturning({
      anchorTableId: tableB,
      groupId,
      name: "Cumpleaños",
      releasedTableIds: [tableA],
      sessionId,
      tables: [
        { label: "1", state: "available", tableId: tableA },
        { label: "2", state: "occupied", tableId: tableB }
      ]
    });
    const result = await createTableRegroupingRepository(
      client as never
    ).separateTables({
      groupId,
      request: { anchorTableId: tableB, commandId },
      scope,
      staffId
    });
    expect(result.releasedTableIds).toEqual([tableA]);
    expect(sqlValues(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      groupId,
      tableB
    ]);
  });

  it("refuses a result that is not canonical", async () => {
    const client = clientReturning({ groupId });
    await expect(
      createTableRegroupingRepository(client as never).joinTables({
        request: { commandId, name: null, tableIds: [tableA, tableB] },
        scope,
        staffId
      })
    ).rejects.toThrow("join result must be canonical");
    await expect(
      createTableRegroupingRepository(client as never).separateTables({
        groupId,
        request: { anchorTableId: null, commandId },
        scope,
        staffId
      })
    ).rejects.toThrow("separate result must be canonical");
  });

  it("refuses a request or scope that is not canonical before touching the database", async () => {
    const client = clientReturning({});
    const repository = createTableRegroupingRepository(client as never);
    await expect(
      repository.joinTables({
        request: { commandId, name: null, tableIds: [tableA] },
        scope,
        staffId
      })
    ).rejects.toThrow("join request must be canonical");
    await expect(
      repository.separateTables({
        groupId,
        request: { anchorTableId: null, commandId },
        scope: { ...scope, tenantId: "nope" },
        staffId
      })
    ).rejects.toThrow("tenant scope must be canonical");
    expect(client).not.toHaveBeenCalled();
  });
});
