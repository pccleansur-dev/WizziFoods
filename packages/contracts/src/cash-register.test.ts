import { describe, expect, it } from "vitest";

import {
  parseCashMovementRequest,
  parseCashMovementResult,
  parseCashRegisterView,
  parseCloseShiftRequest,
  parseCloseShiftResult,
  parseOpenShiftRequest,
  parseOpenShiftResult,
  parseRefundRequest,
  parseRefundResult
} from "./cash-register.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const shiftId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const lineId = "55555555-5555-4555-8555-555555555555";

describe("cash register requests", () => {
  it("opens with a non-negative float and nothing else", () => {
    expect(
      parseOpenShiftRequest({ commandId, openingCashCents: 5000 })
    ).toEqual({
      commandId,
      openingCashCents: 5000
    });
    expect(
      parseOpenShiftRequest({ commandId, openingCashCents: 0 })
    ).not.toBeNull();
    expect(
      parseOpenShiftRequest({ commandId, openingCashCents: -1 })
    ).toBeNull();
    expect(
      parseOpenShiftRequest({ commandId, openingCashCents: 1.5 })
    ).toBeNull();
    expect(
      parseOpenShiftRequest({
        commandId,
        openingCashCents: 1,
        tenantId: shiftId
      })
    ).toBeNull();
  });

  it("needs a kind, a positive amount and a reason for a cash movement", () => {
    expect(
      parseCashMovementRequest({
        amountCents: 2000,
        commandId,
        kind: "cash_out",
        reason: " Retiro a caja fuerte "
      })
    ).toEqual({
      amountCents: 2000,
      commandId,
      kind: "cash_out",
      reason: "Retiro a caja fuerte"
    });
    for (const bad of [
      { amountCents: 0, kind: "cash_out", reason: "x" },
      { amountCents: 1, kind: "gift", reason: "x" },
      { amountCents: 1, kind: "cash_in", reason: "  " },
      { amountCents: 1, kind: "cash_in" }
    ]) {
      expect(parseCashMovementRequest({ commandId, ...bad })).toBeNull();
    }
  });

  it("counts blind: the count and an optional reason, never an expected amount", () => {
    expect(
      parseCloseShiftRequest({
        commandId,
        countedCashCents: 14_000,
        reason: null
      })
    ).toEqual({ commandId, countedCashCents: 14_000, reason: null });
    expect(
      parseCloseShiftRequest({
        commandId,
        countedCashCents: 13_300,
        reason: " Faltó cambio "
      })
    ).toEqual({ commandId, countedCashCents: 13_300, reason: "Faltó cambio" });
    expect(
      parseCloseShiftRequest({
        commandId,
        countedCashCents: 1,
        expectedCashCents: 2,
        reason: null
      })
    ).toBeNull();
    expect(
      parseCloseShiftRequest({ commandId, countedCashCents: -1, reason: null })
    ).toBeNull();
    expect(
      parseCloseShiftRequest({
        commandId,
        countedCashCents: 1,
        reason: "x".repeat(201)
      })
    ).toBeNull();
  });

  it("refunds a payment with an amount and a reason, optionally for an item", () => {
    expect(
      parseRefundRequest({
        amountCents: 4000,
        commandId,
        itemLineId: lineId,
        paymentId,
        reason: "Cerveza cancelada"
      })
    ).toEqual({
      amountCents: 4000,
      commandId,
      itemLineId: lineId,
      paymentId,
      reason: "Cerveza cancelada"
    });
    expect(
      parseRefundRequest({
        amountCents: 1,
        commandId,
        itemLineId: null,
        paymentId,
        reason: "x"
      })
    ).not.toBeNull();
    expect(
      parseRefundRequest({
        amountCents: 1,
        cardNumber: "4111",
        commandId,
        itemLineId: null,
        paymentId,
        reason: "x"
      })
    ).toBeNull();
    expect(
      parseRefundRequest({
        amountCents: 0,
        commandId,
        itemLineId: null,
        paymentId,
        reason: "x"
      })
    ).toBeNull();
  });
});

describe("cash register results", () => {
  it("parses an opening, a movement and a refund", () => {
    const opened = {
      openedAt: "2026-10-25T10:00:00.000Z",
      openingCashCents: 5000,
      shiftId
    };
    expect(parseOpenShiftResult(opened)).toEqual(opened);
    const moved = {
      amountCents: 2000,
      kind: "cash_out",
      movementId: lineId,
      shiftId
    };
    expect(parseCashMovementResult(moved)).toEqual(moved);
    const refund = {
      paymentId,
      pendingCents: -2500,
      refundCents: 1500,
      sessionId,
      shiftId
    };
    expect(parseRefundResult(refund)).toEqual(refund);
    expect(parseRefundResult({ ...refund, refundCents: 0 })).toBeNull();
  });

  it("tells a closing that did not close apart from one that did", () => {
    const pending = { closed: false, differenceCents: -700, shiftId };
    expect(parseCloseShiftResult(pending)).toEqual(pending);
    expect(
      parseCloseShiftResult({ ...pending, expectedCashCents: 14_000 })
    ).toBeNull();
    const closed = {
      breakdown: {
        manualInCents: 1000,
        manualOutCents: 2000,
        methods: { cash: { receivedCents: 14_000, refundedCents: 4000 } },
        tipCents: 500
      },
      closed: true,
      countedCashCents: 13_300,
      differenceCents: -700,
      expectedCashCents: 14_000,
      pendingAccounts: 1,
      pendingCents: 12_500,
      reason: "Faltó cambio",
      shiftId
    };
    expect(parseCloseShiftResult(closed)).toEqual(closed);
    expect(parseCloseShiftResult({ ...closed, differenceCents: 0 })).toBeNull();
    expect(parseCloseShiftResult({ ...closed, reason: null })).toBeNull();
  });
});

describe("cash register view", () => {
  const closure = {
    breakdown: {
      manualInCents: 0,
      manualOutCents: 0,
      methods: {},
      tipCents: 0
    },
    closedAt: "2026-10-25T20:00:00.000Z",
    closedByName: "Marta",
    countedCashCents: 5000,
    differenceCents: 0,
    expectedCashCents: 5000,
    openedAt: "2026-10-25T10:00:00.000Z",
    openedByName: "Marta",
    openingCashCents: 5000,
    pendingAccounts: 0,
    pendingCents: 0,
    reason: null,
    shiftId
  };

  it("parses a closed register for a waiter and an open one for a manager", () => {
    const closedView = {
      canManage: false,
      closures: [],
      generatedAt: "2026-10-25T12:00:00.000Z",
      register: { open: false }
    };
    expect(parseCashRegisterView(closedView)).toEqual(closedView);
    const openView = {
      canManage: true,
      closures: [closure],
      generatedAt: "2026-10-25T12:00:00.000Z",
      register: {
        movements: [
          {
            amountCents: 2000,
            createdAt: "2026-10-25T11:00:00.000Z",
            id: lineId,
            kind: "cash_out",
            reason: "Retiro"
          }
        ],
        open: true,
        openedAt: "2026-10-25T10:00:00.000Z",
        openedByName: "Marta",
        openingCashCents: 5000,
        paymentCount: 3,
        refundCount: 1,
        shiftId
      }
    };
    expect(parseCashRegisterView(openView)).toEqual(openView);
  });

  it("refuses an open register that leaks the expected cash", () => {
    expect(
      parseCashRegisterView({
        canManage: true,
        closures: [],
        generatedAt: "2026-10-25T12:00:00.000Z",
        register: {
          expectedCashCents: 14_000,
          movements: [],
          open: true,
          openedAt: "2026-10-25T10:00:00.000Z",
          openedByName: "Marta",
          openingCashCents: 5000,
          paymentCount: 0,
          refundCount: 0,
          shiftId
        }
      })
    ).toBeNull();
  });

  it("refuses a closure whose difference does not match its counts", () => {
    expect(
      parseCashRegisterView({
        canManage: true,
        closures: [{ ...closure, differenceCents: 5 }],
        generatedAt: "2026-10-25T12:00:00.000Z",
        register: { open: false }
      })
    ).toBeNull();
  });
});
