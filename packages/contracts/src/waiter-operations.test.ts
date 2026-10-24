import { describe, expect, it } from "vitest";

import {
  parseManualOrderRequest,
  parseWaiterCallClaimRequest,
  parseWaiterIntentDecisionRequest,
  parseWaiterOrderResult,
  parseWaiterSalonView
} from "./waiter-operations.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";

describe("waiter operation contracts", () => {
  it("accepts only a command id when a waiter claims a call", () => {
    expect(parseWaiterCallClaimRequest({ commandId })).toEqual({ commandId });
    expect(
      parseWaiterCallClaimRequest({ commandId, tenantId: tableId })
    ).toBeNull();
  });

  it("requires an audited reason when an intent is rejected", () => {
    expect(
      parseWaiterIntentDecisionRequest({
        commandId,
        decision: "reject",
        reason: "Los comensales cambiaron el pedido"
      })
    ).toEqual({
      commandId,
      decision: "reject",
      reason: "Los comensales cambiaron el pedido"
    });
    expect(
      parseWaiterIntentDecisionRequest({
        commandId,
        decision: "reject",
        reason: null
      })
    ).toBeNull();
  });

  it("keeps confirmation distinct from payment and rejects injected totals", () => {
    expect(
      parseWaiterIntentDecisionRequest({
        commandId,
        decision: "confirm",
        reason: null
      })
    ).toEqual({ commandId, decision: "confirm", reason: null });
    expect(
      parseWaiterIntentDecisionRequest({
        commandId,
        decision: "confirm",
        paymentMethod: "cash",
        reason: null
      })
    ).toBeNull();
  });

  it("accepts a manual table order without client prices or scope", () => {
    const request = {
      attribution: "table",
      commandId,
      dinerName: null,
      items: [{ lineId, productId, quantity: 2, variantId: null }],
      seatLabel: null,
      tableId
    };
    expect(parseManualOrderRequest(request)).toEqual(request);
    expect(parseManualOrderRequest({ ...request, totalCents: 1 })).toBeNull();
    expect(
      parseManualOrderRequest({ ...request, tenantId: tableId })
    ).toBeNull();
  });

  it("requires a name for a person-attributed manual order", () => {
    const base = {
      attribution: "individual",
      commandId,
      items: [{ lineId, productId, quantity: 1, variantId: null }],
      seatLabel: "Silla 3",
      tableId
    };
    expect(parseManualOrderRequest({ ...base, dinerName: "  Ana  " })).toEqual({
      ...base,
      dinerName: "Ana"
    });
    expect(parseManualOrderRequest({ ...base, dinerName: null })).toBeNull();
  });
});

describe("waiter operation results", () => {
  const item = {
    lineId,
    productId,
    quantity: 2,
    title: "Milanesa",
    totalCents: 25000,
    unitPriceCents: 12500,
    variantId: null,
    variantTitle: null
  };
  const order = {
    accountDecision: "pending",
    items: [item],
    orderId: "55555555-5555-4555-8555-555555555555",
    payment: { state: "not_recorded" },
    source: "manual",
    status: "confirmed",
    tableId,
    totalCents: 25000
  };

  it("reports a confirmed order with payment explicitly not recorded", () => {
    expect(parseWaiterOrderResult(order)).toEqual(order);
  });

  it("refuses a result that pretends a payment or a production state", () => {
    expect(
      parseWaiterOrderResult({ ...order, payment: { state: "paid" } })
    ).toBeNull();
    expect(
      parseWaiterOrderResult({ ...order, productionStatus: "queued" })
    ).toBeNull();
    expect(parseWaiterOrderResult({ ...order, totalCents: 1 })).toBeNull();
  });

  it("rejects an unknown call state in the live salon view", () => {
    const view = {
      calls: [],
      floors: [],
      generatedAt: "2026-10-24T12:00:00.000Z",
      intents: [],
      units: []
    };
    expect(parseWaiterSalonView(view)).toEqual(view);
    expect(
      parseWaiterSalonView({ ...view, calls: [{ id: commandId, status: "x" }] })
    ).toBeNull();
    expect(parseWaiterSalonView({ ...view, tenantId: tableId })).toBeNull();
  });
});
