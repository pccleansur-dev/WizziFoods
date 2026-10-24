import { describe, expect, it, vi } from "vitest";

import { createFloorPlanRepository } from "./floor-plan-repository.js";

const scope = {
  locationId: "a8000000-0000-4000-8000-000000000008",
  tenantId: "a3000000-0000-4000-8000-000000000003"
};
const requesterId = "a1000000-0000-4000-8000-000000000001";
const tableId = "a2000000-0000-4000-8000-000000000002";
const sectorId = "a5000000-0000-4000-8000-000000000005";
const commandId = "a9000000-0000-4000-8000-000000000009";
const token = "ab".repeat(32);
const plan = {
  groups: [],
  sectors: [{ id: sectorId, name: "Salón", position: 0 }],
  tables: [
    {
      height: 80,
      id: tableId,
      label: "1",
      rotation: 0,
      seatCount: 4,
      seatLayout: "perimeter" as const,
      sectorId,
      shape: "rectangle" as const,
      width: 100,
      x: 40,
      y: 40
    }
  ]
};

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

function clientReturning(rows: unknown[]) {
  return vi.fn(() => Promise.resolve(rows)) as never;
}

describe("floor plan repository", () => {
  it("maps the stored plan and validates it is canonical", async () => {
    const client = clientReturning([{ result: { plan, version: 3 } }]);
    await expect(
      createFloorPlanRepository(client).getPlan(scope, requesterId)
    ).resolves.toEqual({ plan, version: 3 });
  });

  it("rejects a stored plan that is not canonical", async () => {
    const client = clientReturning([
      { result: { plan: { ...plan, tenantId: "x" }, version: 1 } }
    ]);
    await expect(
      createFloorPlanRepository(client).getPlan(scope, requesterId)
    ).rejects.toThrow("floor plan must be canonical");
  });

  it("saves a command and reports whether it was applied", async () => {
    const client = clientReturning([
      { applied: false, result: { plan, version: 2 } }
    ]);
    await expect(
      createFloorPlanRepository(client).savePlan({
        command: { commandId, expectedVersion: 2, plan },
        requesterId,
        scope
      })
    ).resolves.toEqual({ applied: false, plan, version: 2 });
  });

  it("never queries with a non-canonical scope or command", async () => {
    const repository = createFloorPlanRepository(unreachableClient);
    await expect(
      repository.getPlan({ ...scope, tenantId: "nope" }, requesterId)
    ).rejects.toThrow("tenant scope must be canonical");
    await expect(
      repository.savePlan({
        command: { commandId, expectedVersion: -1, plan },
        requesterId,
        scope
      })
    ).rejects.toThrow("floor plan command must be canonical");
  });

  it("lists QR codes for the administrator", async () => {
    const client = clientReturning([{ label: "1", table_id: tableId, token }]);
    await expect(
      createFloorPlanRepository(client).listQrCodes(scope, requesterId)
    ).resolves.toEqual([{ label: "1", tableId, token }]);
  });

  it("resolves a QR token only inside the verified scope", async () => {
    const client = clientReturning([
      { label: "1", sector_name: "Salón", table_id: tableId }
    ]);
    await expect(
      createFloorPlanRepository(client).resolveQr(scope, token)
    ).resolves.toEqual({ label: "1", sectorName: "Salón", tableId });
  });

  it("answers null for malformed tokens without touching the database", async () => {
    const repository = createFloorPlanRepository(unreachableClient);
    await expect(repository.resolveQr(scope, "short")).resolves.toBeNull();
    await expect(
      repository.resolveQr(scope, token.toUpperCase())
    ).resolves.toBeNull();
  });

  it("does not leak the token in errors", async () => {
    const client = (() => Promise.reject(new Error("db down"))) as never;
    const error = await createFloorPlanRepository(client)
      .resolveQr(scope, token)
      .catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain(token);
  });

  it("reports readiness for T15", async () => {
    const readiness = (active: number, withQr: number) =>
      createFloorPlanRepository(
        clientReturning([{ active_tables: active, tables_with_qr: withQr }])
      ).getReadiness(scope);
    await expect(readiness(2, 2)).resolves.toEqual({
      activeTables: 2,
      ready: true,
      tablesWithQr: 2
    });
    await expect(readiness(0, 0)).resolves.toMatchObject({ ready: false });
    await expect(readiness(2, 1)).resolves.toMatchObject({ ready: false });
  });

  it("rotates a table QR", async () => {
    const client = clientReturning([{}]);
    await createFloorPlanRepository(client).rotateQr({
      requesterId,
      scope,
      tableId
    });
    expect(client).toHaveBeenCalledOnce();
  });
});
