import { describe, expect, it, vi } from "vitest";

import { createTableAccountsRepository } from "./table-accounts-repository.js";

const scope = {
  locationId: "1e000000-0000-4000-8000-000000000001",
  tenantId: "1e000000-0000-4000-8000-000000000002"
};
const staffId = "1e000000-0000-4000-8000-000000000003";
const commandId = "1e000000-0000-4000-8000-000000000004";
const sessionId = "1e000000-0000-4000-8000-000000000005";
const tableId = "1e000000-0000-4000-8000-000000000006";

function clientReturning(result: unknown) {
  return vi.fn(() => Promise.resolve([{ result }]));
}

function sqlValues(client: ReturnType<typeof vi.fn>): unknown[] {
  return (client.mock.calls[0] as unknown[]).slice(1);
}

describe("table accounts repository", () => {
  it("normalizes database timestamps in the accounts view", async () => {
    const view = {
      cashRegisterOpen: true,
      accounts: [
        {
          currency: "ARS",
          entries: [
            {
              amountCents: 100,
              cause: "Ítem confirmado: Milanesa",
              createdAt: "2026-10-24T12:00:00.123456+00:00",
              id: 1,
              kind: "charge",
              origin: "order_confirmed",
              paymentMethod: null,
              sourceId: tableId
            }
          ],
          keptOpen: false,
          split: null,
          openedAt: "2026-10-24T11:58:00.123456+00:00",
          sessionId,
          summary: {
            consumedCents: 100,
            discountCents: 0,
            paidCents: 0,
            pendingCents: 100,
            refundedCents: 0,
            tipCents: 0
          },
          tableId,
          tableLabels: ["5"]
        }
      ]
    };
    const result = await createTableAccountsRepository(
      clientReturning(view) as never
    ).getAccounts({ scope, staffId });
    expect(result.accounts[0]?.openedAt).toBe("2026-10-24T11:58:00.123Z");
    expect(result.accounts[0]?.entries[0]?.createdAt).toBe(
      "2026-10-24T12:00:00.123Z"
    );
    expect(result.cashRegisterOpen).toBe(true);
    expect(Number.isFinite(Date.parse(result.generatedAt))).toBe(true);
  });

  it("refuses a view that does not add up or carries unexpected fields", async () => {
    await expect(
      createTableAccountsRepository(
        clientReturning({
          accounts: [],
          cashRegisterOpen: true,
          tenantId: scope.tenantId
        }) as never
      ).getAccounts({ scope, staffId })
    ).rejects.toThrow("accounts view must be canonical");
  });

  it("sends only the payment data to SQL, never a total or a currency", async () => {
    const client = clientReturning({
      amountCents: 10_000,
      paymentCents: 10_500,
      paymentId: tableId,
      pendingCents: 21_900,
      sessionId,
      shiftId: commandId,
      tipCents: 500
    });
    const result = await createTableAccountsRepository(
      client as never
    ).recordPayment({
      request: {
        amountCents: 10_000,
        commandId,
        method: "cash",
        tipCents: 500
      },
      scope,
      sessionId,
      staffId
    });
    expect(result.paymentCents).toBe(10_500);
    expect(sqlValues(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      sessionId,
      "cash",
      10_000,
      500
    ]);
  });

  it("sends the discount and the keep-open decision with the session from the route", async () => {
    const discount = clientReturning({
      discountCents: 2_190,
      pendingCents: 19_710,
      sessionId
    });
    await createTableAccountsRepository(discount as never).applyDiscount({
      request: { commandId, kind: "percent", reason: "Cortesía", value: 1000 },
      scope,
      sessionId,
      staffId
    });
    expect(sqlValues(discount)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      sessionId,
      "percent",
      1000,
      "Cortesía"
    ]);
    const kept = clientReturning({
      decision: "keep_open",
      pendingCents: 8_000,
      sessionId
    });
    await createTableAccountsRepository(kept as never).keepOpen({
      request: { commandId },
      scope,
      sessionId,
      staffId
    });
    expect(sqlValues(kept)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      sessionId
    ]);
  });

  it("refuses a non-canonical scope or result", async () => {
    const client = vi.fn();
    await expect(
      createTableAccountsRepository(client as never).getAccounts({
        scope: { ...scope, tenantId: "nope" },
        staffId
      })
    ).rejects.toThrow("tenant scope must be canonical");
    expect(client).not.toHaveBeenCalled();
    await expect(
      createTableAccountsRepository(
        clientReturning({ paymentCents: 1 }) as never
      ).recordPayment({
        request: { amountCents: 1, commandId, method: "cash", tipCents: 0 },
        scope,
        sessionId,
        staffId
      })
    ).rejects.toThrow("payment result must be canonical");
  });
});
