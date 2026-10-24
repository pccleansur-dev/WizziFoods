import { describe, expect, it, vi } from "vitest";

import { createReadinessRepository } from "./readiness-repository.js";

const scope = {
  locationId: "a8000000-0000-4000-8000-000000000008",
  tenantId: "a3000000-0000-4000-8000-000000000003"
};
const requesterId = "a1000000-0000-4000-8000-000000000001";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

function clientReturning(rows: unknown[]) {
  return vi.fn(() => Promise.resolve(rows)) as never;
}

const report = {
  blockers: ["FLOOR_NO_TABLES"],
  published: null,
  team: { activeManagers: 0, activeMembers: 0 },
  warnings: ["TEAM_EMPTY"]
};

describe("readiness repository", () => {
  it("maps the matrix returned by the database", async () => {
    const repository = createReadinessRepository(
      clientReturning([{ result: report }])
    );
    const result = await repository.get(scope, requesterId);
    expect(result.ready).toBe(false);
    expect(result.items.map((item) => item.code)).toEqual([
      "FLOOR_NO_TABLES",
      "TEAM_EMPTY"
    ]);
  });

  it("fails closed on a code the contract does not know", async () => {
    const repository = createReadinessRepository(
      clientReturning([{ result: { ...report, blockers: ["SURPRISE"] } }])
    );
    await expect(repository.get(scope, requesterId)).rejects.toThrow(
      "canonical"
    );
  });

  it("publishes through the transactional function and returns the matrix", async () => {
    const client = clientReturning([
      {
        result: {
          ...report,
          blockers: [],
          published: {
            at: "2026-10-24T10:00:00+00:00",
            by: requesterId,
            revision: 1
          },
          warnings: []
        }
      }
    ]);
    const result = await createReadinessRepository(client).publish(
      scope,
      requesterId
    );
    expect(result.published?.revision).toBe(1);
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("returns a sandbox run only when it stays in the sandbox namespace", async () => {
    const run = {
      namespace: "sandbox",
      reference: "SBX-ABCD1234",
      runId: "a2000000-0000-4000-8000-000000000002",
      steps: [
        "qr_scanned",
        "order_placed",
        "in_production",
        "payment_recorded",
        "closed",
        "cleaned_up"
      ].map((step) => ({ ok: true, step }))
    };
    const repository = createReadinessRepository(
      clientReturning([{ result: run }])
    );
    await expect(repository.runSandbox(scope, requesterId)).resolves.toEqual(
      run
    );
    await expect(
      createReadinessRepository(
        clientReturning([{ result: { ...run, namespace: "production" } }])
      ).runSandbox(scope, requesterId)
    ).rejects.toThrow("canonical");
  });

  it("reports how many simulated leftovers cleanup removed", async () => {
    const repository = createReadinessRepository(
      clientReturning([{ removed: 2 }])
    );
    await expect(repository.cleanupSandbox(scope, requesterId)).resolves.toBe(
      2
    );
  });

  it("refuses a non-canonical scope or requester before querying", async () => {
    const repository = createReadinessRepository(unreachableClient);
    await expect(
      repository.get({ ...scope, tenantId: "x" }, requesterId)
    ).rejects.toThrow();
    await expect(repository.publish(scope, "nope")).rejects.toThrow(
      "requesterId"
    );
    await expect(repository.runSandbox(scope, "nope")).rejects.toThrow();
    await expect(repository.cleanupSandbox(scope, "nope")).rejects.toThrow();
  });
});
