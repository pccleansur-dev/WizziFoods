import { describe, expect, it, vi } from "vitest";

import { createTableClosingRepository } from "./table-closing-repository.js";

const scope = {
  locationId: "2c000000-0000-4000-8000-000000000001",
  tenantId: "2c000000-0000-4000-8000-000000000002"
};
const staffId = "2c000000-0000-4000-8000-000000000003";
const commandId = "2c000000-0000-4000-8000-000000000004";
const sessionId = "2c000000-0000-4000-8000-000000000005";
const tableId = "2c000000-0000-4000-8000-000000000006";
const requestId = "2c000000-0000-4000-8000-000000000007";

function clientReturning(result: unknown) {
  return vi.fn(() => Promise.resolve([{ result }]));
}

function sqlValues(client: ReturnType<typeof vi.fn>): unknown[] {
  return (client.mock.calls[0] as unknown[]).slice(1);
}

const receipt = {
  businessName: "Parrilla Sur",
  closedAt: "2026-10-25T20:30:00.123456+00:00",
  currency: "ARS",
  discounts: [],
  invoiceNotice:
    "¿Necesitás factura? Por el momento, la facturación se realiza en caja",
  items: [],
  locationName: "Salón",
  notice: "Comprobante de consumo — no válido como factura",
  number: 3,
  openedAt: "2026-10-25T19:00:00.5+00:00",
  payments: [],
  refunds: [],
  sessionId,
  summary: {
    consumedCents: 0,
    discountCents: 0,
    paidCents: 0,
    pendingCents: 0,
    refundedCents: 0,
    tipCents: 0
  },
  tableLabels: ["2"]
};

describe("table closing repository", () => {
  it("closes an account with the canonical scope and normalizes timestamps", async () => {
    const client = clientReturning({
      closedAt: "2026-10-25T20:30:00.123456+00:00",
      receipt,
      sessionId,
      tables: [{ label: "2", state: "needs_cleaning", tableId }]
    });
    const result = await createTableClosingRepository(
      client as never
    ).closeAccount({ request: { commandId }, scope, sessionId, staffId });
    expect(result.closedAt).toBe("2026-10-25T20:30:00.123Z");
    expect(result.receipt.openedAt).toBe("2026-10-25T19:00:00.500Z");
    expect(sqlValues(client)).toEqual([
      scope.tenantId,
      scope.locationId,
      staffId,
      commandId,
      sessionId
    ]);
  });

  it("refuses a receipt that is not canonical", async () => {
    const client = clientReturning({ ...receipt, notice: "Factura" });
    await expect(
      createTableClosingRepository(client as never).getReceipt({
        scope,
        sessionId,
        staffId
      })
    ).rejects.toThrow("receipt must be canonical");
  });

  it("refuses a scope that is not canonical before touching the database", async () => {
    const client = clientReturning({});
    await expect(
      createTableClosingRepository(client as never).cleanTable({
        request: { commandId },
        scope: { ...scope, tenantId: "nope" },
        staffId,
        tableId
      })
    ).rejects.toThrow("tenant scope must be canonical");
    expect(client).not.toHaveBeenCalled();
  });

  it("cleans a table, asks the cashier and resolves the request", async () => {
    const cleaned = createTableClosingRepository(
      clientReturning({ state: "available", tableId }) as never
    );
    await expect(
      cleaned.cleanTable({ request: { commandId }, scope, staffId, tableId })
    ).resolves.toEqual({ state: "available", tableId });

    const asked = createTableClosingRepository(
      clientReturning({
        receiptNumber: 3,
        requestId,
        sessionId,
        status: "open"
      }) as never
    );
    await expect(
      asked.requestCashier({
        request: { commandId },
        scope,
        sessionId,
        staffId
      })
    ).resolves.toMatchObject({ requestId, status: "open" });

    const resolved = createTableClosingRepository(
      clientReturning({ requestId, status: "resolved" }) as never
    );
    await expect(
      resolved.resolveCashierRequest({
        request: { commandId },
        requestId,
        scope,
        staffId
      })
    ).resolves.toEqual({ requestId, status: "resolved" });
  });

  it("lists closed accounts with an ISO generation time", async () => {
    const view = await createTableClosingRepository(
      clientReturning({
        accounts: [
          {
            cashierRequest: null,
            closedAt: "2026-10-25T20:30:00.123456+00:00",
            receiptNumber: 3,
            sessionId,
            tableLabels: ["2"],
            totalCents: 1000
          }
        ]
      }) as never
    ).getClosedAccounts({ scope, staffId });
    expect(view.accounts[0]?.closedAt).toBe("2026-10-25T20:30:00.123Z");
    expect(Number.isFinite(Date.parse(view.generatedAt))).toBe(true);
  });
});
