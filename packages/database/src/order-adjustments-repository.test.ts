import { describe, expect, it, vi } from "vitest";

import { createOrderAdjustmentsRepository } from "./order-adjustments-repository.js";

const scope = {
  locationId: "1b000000-0000-4000-8000-000000000001",
  tenantId: "1b000000-0000-4000-8000-000000000002"
};
const staffId = "1b000000-0000-4000-8000-000000000003";
const commandId = "1b000000-0000-4000-8000-000000000004";
const orderId = "1b000000-0000-4000-8000-000000000005";
const lineId = "1b000000-0000-4000-8000-000000000006";
const productId = "1b000000-0000-4000-8000-000000000007";
const adjustmentId = "1b000000-0000-4000-8000-000000000008";
const tableId = "1b000000-0000-4000-8000-000000000009";

function clientReturning(result: unknown) {
  return vi.fn(() => Promise.resolve([{ result }]));
}

function sqlValues(client: ReturnType<typeof vi.fn>): unknown[] {
  return (client.mock.calls[0] as unknown[]).slice(1);
}

describe("order adjustments repository", () => {
  it("normalizes database timestamps in the waiter orders view", async () => {
    const view = {
      orders: [
        {
          adjustmentCents: 0,
          attribution: "table",
          confirmedAt: "2026-10-24T11:58:00.123456+00:00",
          dinerName: null,
          items: [
            {
              adjustment: null,
              exceptionReason: null,
              lineId,
              quantity: 1,
              sector: "kitchen",
              status: "queued",
              title: "Milanesa",
              totalCents: 100,
              unitPriceCents: 100,
              variantTitle: null
            }
          ],
          orderId,
          seatLabel: null,
          status: "queued",
          tableId,
          tableLabel: "7",
          totalCents: 100
        }
      ]
    };
    const result = await createOrderAdjustmentsRepository(
      clientReturning(view) as never
    ).getOrders({ scope, staffId });
    expect(result.orders[0]?.confirmedAt).toBe("2026-10-24T11:58:00.123Z");
    expect(Number.isFinite(Date.parse(result.generatedAt))).toBe(true);
  });

  it("refuses a view with unexpected fields", async () => {
    await expect(
      createOrderAdjustmentsRepository(
        clientReturning({ orders: [], tenantId: scope.tenantId }) as never
      ).getOrders({ scope, staffId })
    ).rejects.toThrow("waiter orders view must be canonical");
  });

  it("sends the scope, the staff id and only the delivery data to SQL", async () => {
    const client = clientReturning({
      changed: true,
      lineId,
      orderId,
      orderStatus: "ready",
      status: "delivered"
    });
    await createOrderAdjustmentsRepository(client as never).deliverItem({
      lineId,
      orderId,
      request: { commandId },
      scope,
      staffId
    });
    expect(sqlValues(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      orderId,
      lineId
    ]);
  });

  it("passes the reason of a shortage and of a cancellation", async () => {
    const state = {
      changed: true,
      lineId,
      orderId,
      orderStatus: "exception",
      status: "exception"
    };
    const shortage = clientReturning(state);
    await createOrderAdjustmentsRepository(shortage as never).reportException({
      lineId,
      orderId,
      request: { commandId, reason: "Se terminó" },
      scope,
      staffId
    });
    expect(sqlValues(shortage).at(-1)).toBe("Se terminó");

    const cancellation = clientReturning({
      adjustmentId,
      differenceCents: -100,
      lineId,
      orderId,
      orderStatus: "cancelled",
      status: "cancelled"
    });
    await createOrderAdjustmentsRepository(cancellation as never).cancelItem({
      lineId,
      orderId,
      request: { commandId, reason: "Sin reemplazo" },
      scope,
      staffId
    });
    expect(sqlValues(cancellation).at(-1)).toBe("Sin reemplazo");
  });

  it("proposes and decides a replacement without any price", async () => {
    const proposal = clientReturning({
      adjustmentId,
      differenceCents: 50,
      lineId,
      orderId,
      originalTotalCents: 100,
      replacementTitle: "Vino",
      replacementTotalCents: 150,
      replacementVariantTitle: null,
      status: "proposed"
    });
    const result = await createOrderAdjustmentsRepository(
      proposal as never
    ).proposeReplacement({
      lineId,
      orderId,
      request: { commandId, productId, variantId: null },
      scope,
      staffId
    });
    expect(result.differenceCents).toBe(50);
    expect(sqlValues(proposal)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      orderId,
      lineId,
      productId,
      null
    ]);

    const decision = clientReturning({
      adjustmentId,
      orderStatus: "queued",
      replacementLineId: lineId,
      status: "accepted"
    });
    await createOrderAdjustmentsRepository(decision as never).decideReplacement(
      {
        adjustmentId,
        request: { commandId, decision: "accept", reason: null },
        scope,
        staffId
      }
    );
    expect(sqlValues(decision)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      adjustmentId,
      "accept",
      null
    ]);
  });

  it("refuses a non-canonical scope or result", async () => {
    const client = vi.fn();
    await expect(
      createOrderAdjustmentsRepository(client as never).getOrders({
        scope: { ...scope, tenantId: "nope" },
        staffId
      })
    ).rejects.toThrow("tenant scope must be canonical");
    expect(client).not.toHaveBeenCalled();
    await expect(
      createOrderAdjustmentsRepository(
        clientReturning({ changed: true }) as never
      ).deliverItem({ lineId, orderId, request: { commandId }, scope, staffId })
    ).rejects.toThrow("item state result must be canonical");
  });
});
