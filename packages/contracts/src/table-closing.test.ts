import { describe, expect, it } from "vitest";

import {
  parseAccountReceipt,
  parseCashierRequestResult,
  parseCleanTableResult,
  parseCloseAccountResult,
  parseClosedAccountsView,
  parseTableClosingCommand,
  RECEIPT_INVOICE_NOTICE,
  RECEIPT_NOTICE
} from "./table-closing.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";

const receipt = {
  businessName: "Parrilla Sur",
  closedAt: "2026-10-25T20:30:00.000Z",
  currency: "ARS",
  discounts: [{ amountCents: 500, cause: "Cortesía" }],
  invoiceNotice: RECEIPT_INVOICE_NOTICE,
  items: [
    {
      lineId: "55555555-5555-4555-8555-555555555555",
      quantity: 2,
      title: "Milanesa",
      totalCents: 25_000
    }
  ],
  locationName: "Salón",
  notice: RECEIPT_NOTICE,
  number: 12,
  openedAt: "2026-10-25T19:00:00.000Z",
  payments: [{ amountCents: 24_500, method: "cash" }],
  refunds: [],
  sessionId,
  summary: {
    consumedCents: 25_000,
    discountCents: 500,
    paidCents: 24_500,
    pendingCents: 0,
    refundedCents: 0,
    tipCents: 0
  },
  tableLabels: ["2", "3"]
};

describe("table closing requests", () => {
  it("accepts only a command id", () => {
    expect(parseTableClosingCommand({ commandId })).toEqual({ commandId });
    expect(parseTableClosingCommand({ commandId, sessionId })).toBeNull();
    expect(parseTableClosingCommand({ commandId: "nope" })).toBeNull();
    expect(parseTableClosingCommand(null)).toBeNull();
  });
});

describe("account receipt", () => {
  it("is canonical only when it says it is not an invoice", () => {
    expect(parseAccountReceipt(receipt)).toEqual({
      ...receipt,
      cashierRequest: null
    });
    expect(parseAccountReceipt({ ...receipt, notice: "Factura" })).toBeNull();
    expect(
      parseAccountReceipt({ ...receipt, invoiceNotice: "Facturamos acá" })
    ).toBeNull();
  });

  it("is only issued with a zero balance and rejects fiscal data", () => {
    expect(
      parseAccountReceipt({
        ...receipt,
        summary: { ...receipt.summary, paidCents: 24_000, pendingCents: 500 }
      })
    ).toBeNull();
    expect(parseAccountReceipt({ ...receipt, cuit: "20-1-1" })).toBeNull();
    expect(parseAccountReceipt({ ...receipt, number: 0 })).toBeNull();
  });

  it("carries the state of the cashier request", () => {
    expect(
      parseAccountReceipt({
        ...receipt,
        cashierRequest: { requestId, status: "open" }
      })?.cashierRequest
    ).toEqual({ requestId, status: "open" });
    expect(
      parseAccountReceipt({
        ...receipt,
        cashierRequest: { requestId, status: "done" }
      })
    ).toBeNull();
  });
});

describe("table closing results", () => {
  it("parses a close with its receipt and the tables waiting for cleaning", () => {
    const result = {
      closedAt: "2026-10-25T20:30:00.000Z",
      receipt,
      sessionId,
      tables: [{ label: "2", state: "needs_cleaning", tableId }]
    };
    expect(parseCloseAccountResult(result)?.tables[0]?.state).toBe(
      "needs_cleaning"
    );
    expect(
      parseCloseAccountResult({
        ...result,
        tables: [{ label: "2", state: "available", tableId }]
      })
    ).toBeNull();
    expect(parseCloseAccountResult({ ...result, extra: true })).toBeNull();
  });

  it("parses cleaning, the cashier request and the closed list", () => {
    expect(parseCleanTableResult({ state: "available", tableId })).toEqual({
      state: "available",
      tableId
    });
    expect(parseCleanTableResult({ state: "occupied", tableId })).toBeNull();
    expect(
      parseCashierRequestResult({
        receiptNumber: 12,
        requestId,
        sessionId,
        status: "open"
      })
    ).toEqual({ receiptNumber: 12, requestId, sessionId, status: "open" });
    expect(
      parseClosedAccountsView({
        accounts: [
          {
            cashierRequest: null,
            closedAt: "2026-10-25T20:30:00.000Z",
            receiptNumber: 12,
            sessionId,
            tableLabels: ["2"],
            totalCents: 25_000
          }
        ],
        generatedAt: "2026-10-25T20:31:00.000Z"
      })?.accounts
    ).toHaveLength(1);
  });
});
