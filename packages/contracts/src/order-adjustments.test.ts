import { describe, expect, it } from "vitest";

import {
  parseCancelItemRequest,
  parseCancelItemResult,
  parseDeliverItemRequest,
  parseItemStateResult,
  parseProductionExceptionRequest,
  parseReplacementDecisionRequest,
  parseReplacementDecisionResult,
  parseReplacementProposalRequest,
  parseReplacementProposalResult,
  parseWaiterOrdersView
} from "./order-adjustments.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const adjustmentId = "55555555-5555-4555-8555-555555555555";
const tableId = "66666666-6666-4666-8666-666666666666";

describe("order adjustment requests", () => {
  it("accepts only a command id to deliver an item", () => {
    expect(parseDeliverItemRequest({ commandId })).toEqual({ commandId });
    expect(
      parseDeliverItemRequest({ commandId, status: "delivered" })
    ).toBeNull();
    expect(parseDeliverItemRequest({})).toBeNull();
  });

  it("requires a reason for a shortage and trims it", () => {
    expect(
      parseProductionExceptionRequest({ commandId, reason: "  Se terminó  " })
    ).toEqual({ commandId, reason: "Se terminó" });
    expect(
      parseProductionExceptionRequest({ commandId, reason: "  " })
    ).toBeNull();
    expect(
      parseProductionExceptionRequest({ commandId, reason: "x".repeat(201) })
    ).toBeNull();
    expect(
      parseProductionExceptionRequest({
        commandId,
        reason: "x",
        tenantId: orderId
      })
    ).toBeNull();
  });

  it("takes only a product and an optional variant for a replacement, never a price", () => {
    expect(
      parseReplacementProposalRequest({ commandId, productId, variantId: null })
    ).toEqual({ commandId, productId, variantId: null });
    expect(
      parseReplacementProposalRequest({
        commandId,
        productId,
        variantId: lineId
      })
    ).toEqual({ commandId, productId, variantId: lineId });
    expect(
      parseReplacementProposalRequest({
        commandId,
        priceCents: 1,
        productId,
        variantId: null
      })
    ).toBeNull();
  });

  it("needs a reason only when the diner rejects the replacement", () => {
    expect(
      parseReplacementDecisionRequest({
        commandId,
        decision: "accept",
        reason: null
      })
    ).toEqual({ commandId, decision: "accept", reason: null });
    expect(
      parseReplacementDecisionRequest({
        commandId,
        decision: "accept",
        reason: "x"
      })
    ).toBeNull();
    expect(
      parseReplacementDecisionRequest({
        commandId,
        decision: "reject",
        reason: null
      })
    ).toBeNull();
    expect(
      parseReplacementDecisionRequest({
        commandId,
        decision: "reject",
        reason: "No quiere"
      })
    ).toEqual({ commandId, decision: "reject", reason: "No quiere" });
  });

  it("requires a reason to cancel an item", () => {
    expect(
      parseCancelItemRequest({ commandId, reason: "Sin reemplazo" })
    ).toEqual({
      commandId,
      reason: "Sin reemplazo"
    });
    expect(parseCancelItemRequest({ commandId })).toBeNull();
  });
});

describe("order adjustment results", () => {
  it("parses an item state result", () => {
    const result = {
      changed: true,
      lineId,
      orderId,
      orderStatus: "exception",
      status: "exception"
    };
    expect(parseItemStateResult(result)).toEqual(result);
    expect(parseItemStateResult({ ...result, status: "queued" })).toBeNull();
    expect(parseItemStateResult({ ...result, orderStatus: "paid" })).toBeNull();
  });

  it("parses a proposal and checks its arithmetic", () => {
    const proposal = {
      adjustmentId,
      differenceCents: 4400,
      lineId,
      orderId,
      originalTotalCents: 4000,
      replacementTitle: "Vino",
      replacementTotalCents: 8400,
      replacementVariantTitle: "Reserva",
      status: "proposed"
    };
    expect(parseReplacementProposalResult(proposal)).toEqual(proposal);
    expect(
      parseReplacementProposalResult({ ...proposal, differenceCents: 1 })
    ).toBeNull();
  });

  it("parses a replacement decision and a cancellation", () => {
    const accepted = {
      adjustmentId,
      orderStatus: "queued",
      replacementLineId: lineId,
      status: "accepted"
    };
    expect(parseReplacementDecisionResult(accepted)).toEqual(accepted);
    expect(
      parseReplacementDecisionResult({ ...accepted, replacementLineId: null })
    ).toBeNull();
    expect(
      parseReplacementDecisionResult({
        ...accepted,
        replacementLineId: null,
        status: "rejected"
      })
    ).toMatchObject({ status: "rejected" });
    const cancelled = {
      adjustmentId,
      differenceCents: -9000,
      lineId,
      orderId,
      orderStatus: "cancelled",
      status: "cancelled"
    };
    expect(parseCancelItemResult(cancelled)).toEqual(cancelled);
    expect(
      parseCancelItemResult({ ...cancelled, differenceCents: 9000 })
    ).toBeNull();
  });
});

describe("waiter orders view", () => {
  const view = {
    generatedAt: "2026-10-24T12:00:00.000Z",
    orders: [
      {
        adjustmentCents: 0,
        attribution: "table",
        confirmedAt: "2026-10-24T11:58:00.000Z",
        dinerName: null,
        items: [
          {
            adjustment: null,
            exceptionReason: null,
            lineId,
            quantity: 2,
            sector: "kitchen",
            status: "ready",
            title: "Milanesa",
            totalCents: 25000,
            unitPriceCents: 12500,
            variantTitle: null
          }
        ],
        orderId,
        seatLabel: null,
        status: "ready",
        tableId,
        tableLabel: "7",
        totalCents: 25000
      }
    ]
  };

  it("parses a canonical view", () => {
    expect(parseWaiterOrdersView(view)).toEqual(view);
  });

  it("parses an item with a shortage and its linked adjustment", () => {
    const withAdjustment = structuredClone(view);
    withAdjustment.orders[0]!.items[0] = {
      ...withAdjustment.orders[0]!.items[0]!,
      adjustment: {
        differenceCents: 4400,
        id: adjustmentId,
        kind: "replacement",
        replacementTitle: "Vino (Reserva)",
        status: "proposed"
      } as never,
      exceptionReason: "Se terminó" as never,
      status: "exception"
    };
    expect(parseWaiterOrdersView(withAdjustment)).not.toBeNull();
  });

  it.each([
    ["an unknown field", { ...view, tenantId: orderId }],
    [
      "an unknown item status",
      {
        ...view,
        orders: [
          {
            ...view.orders[0],
            items: [{ ...view.orders[0]!.items[0], status: "paid" }]
          }
        ]
      }
    ],
    [
      "an order without items",
      { ...view, orders: [{ ...view.orders[0], items: [] }] }
    ]
  ])("rejects %s", (_name, value) => {
    expect(parseWaiterOrdersView(value)).toBeNull();
  });
});
