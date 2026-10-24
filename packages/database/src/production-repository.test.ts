import { describe, expect, it, vi } from "vitest";

import { createProductionRepository } from "./production-repository.js";

const scope = {
  locationId: "1a000000-0000-4000-8000-000000000001",
  tenantId: "1a000000-0000-4000-8000-000000000002"
};
const staffId = "1a000000-0000-4000-8000-000000000003";
const commandId = "1a000000-0000-4000-8000-000000000004";
const orderId = "1a000000-0000-4000-8000-000000000005";
const lineId = "1a000000-0000-4000-8000-000000000006";
const tableId = "1a000000-0000-4000-8000-000000000007";

function clientReturning(rows: unknown[]) {
  return vi.fn(() => Promise.resolve(rows)) as never;
}

const ticket = {
  attribution: "table",
  confirmedAt: "2026-10-24T11:58:00.123456+00:00",
  dinerName: null,
  items: [
    { lineId, quantity: 1, status: "queued", title: "Milanesa", variantTitle: null }
  ],
  orderId,
  orderStatus: "queued",
  seatLabel: null,
  status: "queued",
  tableId,
  tableLabel: "7"
};

describe("production repository", () => {
  it("normalizes database timestamps in the board", async () => {
    const board = await createProductionRepository(
      clientReturning([{ result: { sector: "kitchen", tickets: [ticket] } }])
    ).getBoard({ scope, staffId });
    expect(board.sector).toBe("kitchen");
    expect(board.tickets[0]?.confirmedAt).toBe("2026-10-24T11:58:00.123Z");
    expect(Number.isFinite(Date.parse(board.generatedAt))).toBe(true);
  });

  it("refuses a board with unexpected fields", async () => {
    await expect(
      createProductionRepository(
        clientReturning([
          { result: { sector: "kitchen", tenantId: scope.tenantId, tickets: [] } }
        ])
      ).getBoard({ scope, staffId })
    ).rejects.toThrow("production board must be canonical");
  });

  it("sends the scope, the staff id and only the advance data to SQL", async () => {
    const client = vi.fn(() =>
      Promise.resolve([
        {
          result: {
            changed: true,
            lineId,
            orderId,
            orderStatus: "in_preparation",
            status: "preparing"
          }
        }
      ])
    );
    const result = await createProductionRepository(client as never).advanceItem({
      lineId,
      orderId,
      request: { commandId, status: "preparing" },
      scope,
      staffId
    });
    expect(result).toEqual({
      changed: true,
      lineId,
      orderId,
      orderStatus: "in_preparation",
      status: "preparing"
    });
    const values = (client.mock.calls[0] as unknown[]).slice(1);
    expect(values).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      orderId,
      lineId,
      "preparing"
    ]);
  });

  it("refuses a non-canonical scope before touching the database", async () => {
    const client = vi.fn();
    await expect(
      createProductionRepository(client as never).getBoard({
        scope: { ...scope, tenantId: "not-a-uuid" },
        staffId
      })
    ).rejects.toThrow("tenant scope must be canonical");
    expect(client).not.toHaveBeenCalled();
  });
});
