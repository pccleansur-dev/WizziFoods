import { describe, expect, it, vi } from "vitest";

import { createCashRegisterRepository } from "./cash-register-repository.js";

const scope = {
  locationId: "2b000000-0000-4000-8000-000000000001",
  tenantId: "2b000000-0000-4000-8000-000000000002"
};
const staffId = "2b000000-0000-4000-8000-000000000003";
const commandId = "2b000000-0000-4000-8000-000000000004";
const shiftId = "2b000000-0000-4000-8000-000000000005";
const sessionId = "2b000000-0000-4000-8000-000000000006";
const paymentId = "2b000000-0000-4000-8000-000000000007";

function clientReturning(result: unknown) {
  return vi.fn(() => Promise.resolve([{ result }]));
}

function sqlValues(client: ReturnType<typeof vi.fn>): unknown[] {
  return (client.mock.calls[0] as unknown[]).slice(1);
}

describe("cash register repository", () => {
  it("normalizes database timestamps in the register view", async () => {
    const view = {
      canManage: true,
      closures: [],
      register: {
        movements: [
          {
            amountCents: 2000,
            createdAt: "2026-10-25T11:00:00.123456+00:00",
            id: paymentId,
            kind: "cash_out",
            reason: "Retiro"
          }
        ],
        open: true,
        openedAt: "2026-10-25T10:00:00.123456+00:00",
        openedByName: "Marta",
        openingCashCents: 5000,
        paymentCount: 1,
        refundCount: 0,
        shiftId
      }
    };
    const result = await createCashRegisterRepository(
      clientReturning(view) as never
    ).getRegister({ scope, staffId });
    expect(result.register).toMatchObject({
      open: true,
      openedAt: "2026-10-25T10:00:00.123Z"
    });
    expect(Number.isFinite(Date.parse(result.generatedAt))).toBe(true);
  });

  it("refuses a view that leaks the expected cash", async () => {
    await expect(
      createCashRegisterRepository(
        clientReturning({
          canManage: true,
          closures: [],
          register: { expectedCashCents: 1, open: false }
        }) as never
      ).getRegister({ scope, staffId })
    ).rejects.toThrow("register view must be canonical");
  });

  it("opens with the scope from the session and nothing else", async () => {
    const client = clientReturning({
      openedAt: "2026-10-25T10:00:00.000Z",
      openingCashCents: 5000,
      shiftId
    });
    await createCashRegisterRepository(client as never).openShift({
      request: { commandId, openingCashCents: 5000 },
      scope,
      staffId
    });
    expect(sqlValues(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      5000
    ]);
  });

  it("sends a cash movement, a blind count and a refund with their own data", async () => {
    const movement = clientReturning({
      amountCents: 2000,
      kind: "cash_out",
      movementId: paymentId,
      shiftId
    });
    await createCashRegisterRepository(movement as never).recordMovement({
      request: {
        amountCents: 2000,
        commandId,
        kind: "cash_out",
        reason: "Retiro"
      },
      scope,
      staffId
    });
    expect(sqlValues(movement)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      "cash_out",
      2000,
      "Retiro"
    ]);

    const close = clientReturning({
      closed: false,
      differenceCents: -700,
      shiftId
    });
    const closed = await createCashRegisterRepository(
      close as never
    ).closeShift({
      request: { commandId, countedCashCents: 13_300, reason: null },
      scope,
      staffId
    });
    expect(closed).toEqual({ closed: false, differenceCents: -700, shiftId });
    expect(sqlValues(close)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      13_300,
      null
    ]);

    const refund = clientReturning({
      paymentId,
      pendingCents: -2500,
      refundCents: 1500,
      sessionId,
      shiftId
    });
    await createCashRegisterRepository(refund as never).recordRefund({
      request: {
        amountCents: 1500,
        commandId,
        itemLineId: null,
        paymentId,
        reason: "Cerveza cancelada"
      },
      scope,
      sessionId,
      staffId
    });
    expect(sqlValues(refund)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      sessionId,
      paymentId,
      1500,
      null,
      "Cerveza cancelada"
    ]);
  });

  it("refuses a non-canonical scope or result", async () => {
    const client = vi.fn();
    await expect(
      createCashRegisterRepository(client as never).getRegister({
        scope: { ...scope, tenantId: "nope" },
        staffId
      })
    ).rejects.toThrow("tenant scope must be canonical");
    expect(client).not.toHaveBeenCalled();
    await expect(
      createCashRegisterRepository(
        clientReturning({ closed: true }) as never
      ).closeShift({
        request: { commandId, countedCashCents: 1, reason: null },
        scope,
        staffId
      })
    ).rejects.toThrow("closing result must be canonical");
  });
});
