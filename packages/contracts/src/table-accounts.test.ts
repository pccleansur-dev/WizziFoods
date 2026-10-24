import { describe, expect, it } from "vitest";

import {
  parseApplyDiscountRequest,
  parseDiscountResult,
  parseKeepOpenRequest,
  parseKeepOpenResult,
  parsePaymentResult,
  parseRecordPaymentRequest,
  parseWaiterAccountsView
} from "./table-accounts.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";

describe("table account requests", () => {
  it("accepts a method, an optional amount and a tip, never a total or a currency", () => {
    expect(
      parseRecordPaymentRequest({
        amountCents: 10_000,
        commandId,
        method: "cash",
        tipCents: 500
      })
    ).toEqual({
      amountCents: 10_000,
      commandId,
      method: "cash",
      tipCents: 500
    });
    expect(
      parseRecordPaymentRequest({
        amountCents: null,
        commandId,
        method: "credit_card",
        tipCents: 0
      })
    ).toEqual({
      amountCents: null,
      commandId,
      method: "credit_card",
      tipCents: 0
    });
  });

  it.each([
    [
      "an online method",
      { amountCents: 1, commandId, method: "mercado_pago", tipCents: 0 }
    ],
    [
      "a zero amount",
      { amountCents: 0, commandId, method: "cash", tipCents: 0 }
    ],
    [
      "a negative tip",
      { amountCents: 1, commandId, method: "cash", tipCents: -1 }
    ],
    [
      "a fractional amount",
      { amountCents: 1.5, commandId, method: "cash", tipCents: 0 }
    ],
    [
      "a card number",
      {
        amountCents: 1,
        cardNumber: "4111",
        commandId,
        method: "credit_card",
        tipCents: 0
      }
    ],
    [
      "a client currency",
      {
        amountCents: 1,
        commandId,
        currency: "USD",
        method: "cash",
        tipCents: 0
      }
    ],
    ["a missing tip", { amountCents: 1, commandId, method: "cash" }]
  ])("rejects a payment with %s", (_name, body) => {
    expect(parseRecordPaymentRequest(body)).toBeNull();
  });

  it("parses a discount by amount or by basis points and requires a reason", () => {
    expect(
      parseApplyDiscountRequest({
        commandId,
        kind: "percent",
        reason: " Cortesía ",
        value: 1000
      })
    ).toEqual({ commandId, kind: "percent", reason: "Cortesía", value: 1000 });
    expect(
      parseApplyDiscountRequest({
        commandId,
        kind: "amount",
        reason: "x",
        value: 500
      })
    ).toMatchObject({ kind: "amount" });
    expect(
      parseApplyDiscountRequest({
        commandId,
        kind: "percent",
        reason: "x",
        value: 10_001
      })
    ).toBeNull();
    expect(
      parseApplyDiscountRequest({
        commandId,
        kind: "amount",
        reason: "  ",
        value: 5
      })
    ).toBeNull();
    expect(
      parseApplyDiscountRequest({
        commandId,
        kind: "amount",
        reason: "x",
        value: 0
      })
    ).toBeNull();
  });

  it("takes only a command id to leave an account open", () => {
    expect(parseKeepOpenRequest({ commandId })).toEqual({ commandId });
    expect(parseKeepOpenRequest({ commandId, sessionId })).toBeNull();
  });
});

describe("table account results", () => {
  it("parses a payment and checks that its parts add up", () => {
    const result = {
      amountCents: 10_000,
      paymentCents: 10_500,
      pendingCents: 21_900,
      sessionId,
      tipCents: 500
    };
    expect(parsePaymentResult(result)).toEqual(result);
    expect(parsePaymentResult({ ...result, paymentCents: 10_000 })).toBeNull();
  });

  it("parses a discount and a kept-open decision", () => {
    const discount = { discountCents: 2_190, pendingCents: 19_710, sessionId };
    expect(parseDiscountResult(discount)).toEqual(discount);
    expect(parseDiscountResult({ ...discount, discountCents: 0 })).toBeNull();
    const kept = { decision: "keep_open", pendingCents: 8_000, sessionId };
    expect(parseKeepOpenResult(kept)).toEqual(kept);
    expect(parseKeepOpenResult({ ...kept, decision: "paid" })).toBeNull();
  });
});

describe("waiter accounts view", () => {
  const account = {
    currency: "ARS",
    entries: [
      {
        amountCents: 25_000,
        cause: "Ítem confirmado: Milanesa",
        createdAt: "2026-10-24T12:00:00.000Z",
        id: 1,
        kind: "charge",
        origin: "order_confirmed",
        paymentMethod: null
      },
      {
        amountCents: -10_000,
        cause: "Cobro presencial",
        createdAt: "2026-10-24T12:05:00.000Z",
        id: 2,
        kind: "payment",
        origin: "payment",
        paymentMethod: "cash"
      }
    ],
    keptOpen: false,
    openedAt: "2026-10-24T11:58:00.000Z",
    sessionId,
    summary: {
      consumedCents: 25_000,
      discountCents: 0,
      paidCents: 10_000,
      pendingCents: 15_000,
      refundedCents: 0,
      tipCents: 0
    },
    tableId,
    tableLabels: ["5"]
  };
  const view = { accounts: [account], generatedAt: "2026-10-24T12:10:00.000Z" };

  it("parses a canonical view", () => {
    expect(parseWaiterAccountsView(view)).toEqual(view);
  });

  it("rejects a balance that does not follow from its summary parts", () => {
    expect(
      parseWaiterAccountsView({
        ...view,
        accounts: [
          { ...account, summary: { ...account.summary, pendingCents: 1 } }
        ]
      })
    ).toBeNull();
  });

  it.each([
    ["an unknown field", { ...view, tenantId: sessionId }],
    [
      "another currency",
      { ...view, accounts: [{ ...account, currency: "USD" }] }
    ],
    [
      "a payment with a positive amount",
      {
        ...view,
        accounts: [
          {
            ...account,
            entries: [{ ...account.entries[1], amountCents: 10_000 }]
          }
        ]
      }
    ],
    [
      "an unknown movement kind",
      {
        ...view,
        accounts: [
          { ...account, entries: [{ ...account.entries[0], kind: "gift" }] }
        ]
      }
    ]
  ])("rejects %s", (_name, value) => {
    expect(parseWaiterAccountsView(value)).toBeNull();
  });
});
