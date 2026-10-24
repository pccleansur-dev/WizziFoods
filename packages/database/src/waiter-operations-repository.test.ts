import { describe, expect, it, vi } from "vitest";

import { createWaiterOperationsRepository } from "./waiter-operations-repository.js";

const scope = {
  locationId: "19000000-0000-4000-8000-000000000001",
  tenantId: "19000000-0000-4000-8000-000000000002"
};
const staffId = "19000000-0000-4000-8000-000000000003";
const commandId = "19000000-0000-4000-8000-000000000004";
const callId = "19000000-0000-4000-8000-000000000005";
const intentId = "19000000-0000-4000-8000-000000000006";
const tableId = "19000000-0000-4000-8000-000000000007";
const lineId = "19000000-0000-4000-8000-000000000008";
const productId = "19000000-0000-4000-8000-000000000009";

const item = {
  lineId,
  productId,
  quantity: 2,
  title: "Milanesa",
  totalCents: 25_000,
  unitPriceCents: 12_500,
  variantId: null,
  variantTitle: null
};
const order = {
  accountDecision: "pending" as const,
  items: [item],
  orderId: "19000000-0000-4000-8000-00000000000a",
  payment: { state: "not_recorded" as const },
  source: "intent" as const,
  status: "confirmed" as const,
  tableId,
  totalCents: 25_000
};

function clientReturning(rows: unknown[]) {
  return vi.fn(() => Promise.resolve(rows)) as never;
}

describe("waiter operations repository", () => {
  it("normalizes database timestamps in the salon view", async () => {
    const view = {
      calls: [
        {
          claimedByMe: false,
          claimedByName: null,
          createdAt: "2026-10-24T12:00:00.123456+00:00",
          id: callId,
          intentId,
          paymentMethod: "cash",
          reason: "order_validation",
          status: "open",
          tableId,
          tableLabel: "4"
        }
      ],
      floors: [],
      intents: [],
      units: []
    };
    const result = await createWaiterOperationsRepository(
      clientReturning([{ result: view }])
    ).getSalon({ scope, staffId });
    expect(result.calls[0]?.createdAt).toBe("2026-10-24T12:00:00.123Z");
    expect(Number.isFinite(Date.parse(result.generatedAt))).toBe(true);
  });

  it("refuses a view that carries unexpected fields", async () => {
    await expect(
      createWaiterOperationsRepository(
        clientReturning([
          { result: { calls: [], floors: [], intents: [], units: [], x: 1 } }
        ])
      ).getSalon({ scope, staffId })
    ).rejects.toThrow("salon view must be canonical");
  });

  it("claims a call with the session staff id and a canonical request", async () => {
    const client = clientReturning([
      { result: { callId, claimedByMe: true, status: "acknowledged" } }
    ]);
    await expect(
      createWaiterOperationsRepository(client).claimCall({
        callId,
        request: { commandId },
        scope,
        staffId
      })
    ).resolves.toEqual({ callId, claimedByMe: true, status: "acknowledged" });
    expect(client).toHaveBeenCalledOnce();
  });

  it("rejects non-canonical requests before querying", async () => {
    const client = vi.fn(() => {
      throw new Error("database must not be queried");
    }) as never;
    const repository = createWaiterOperationsRepository(client);
    await expect(
      repository.decideIntent({
        intentId,
        request: { commandId, decision: "reject", reason: null } as never,
        scope,
        staffId
      })
    ).rejects.toThrow("waiter request must be canonical");
    await expect(
      repository.claimCall({
        callId,
        request: { commandId, tenantId: scope.tenantId } as never,
        scope,
        staffId
      })
    ).rejects.toThrow("waiter request must be canonical");
    await expect(
      repository.createManualOrder({
        request: {
          attribution: "table",
          commandId,
          dinerName: null,
          items: [{ lineId, productId, quantity: 1, variantId: null }],
          seatLabel: null,
          tableId,
          totalCents: 1
        } as never,
        scope,
        staffId
      })
    ).rejects.toThrow("waiter request must be canonical");
    expect(client).not.toHaveBeenCalled();
  });

  it("returns a confirmed order that never carries a payment", async () => {
    const repository = createWaiterOperationsRepository(
      clientReturning([{ result: { decision: "confirmed", order } }])
    );
    await expect(
      repository.decideIntent({
        intentId,
        request: { commandId, decision: "confirm", reason: null },
        scope,
        staffId
      })
    ).resolves.toEqual({ decision: "confirmed", order });
  });

  it("refuses a result that claims a payment", async () => {
    const repository = createWaiterOperationsRepository(
      clientReturning([{ result: { ...order, payment: { state: "paid" } } }])
    );
    await expect(
      repository.createManualOrder({
        request: {
          attribution: "table",
          commandId,
          dinerName: null,
          items: [{ lineId, productId, quantity: 2, variantId: null }],
          seatLabel: null,
          tableId
        },
        scope,
        staffId
      })
    ).rejects.toThrow("order result must be canonical");
  });

  it("rejects a non-canonical scope", async () => {
    await expect(
      createWaiterOperationsRepository(clientReturning([])).getSalon({
        scope: { ...scope, tenantId: "not-a-uuid" },
        staffId
      })
    ).rejects.toThrow("tenant scope must be canonical");
  });
});
