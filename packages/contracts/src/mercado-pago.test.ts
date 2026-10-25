import { describe, expect, it } from "vitest";

import {
  isTableToken,
  parseBeginOnlinePaymentResult,
  parseDinerPaymentTarget,
  parseMercadoPagoConnectResult,
  parseMercadoPagoNotification,
  parseOnlineCheckout,
  parseOnlinePaymentView,
  parseOnlineRefundRequest,
  parseOnlineRefundResult,
  parsePayOnlinePaymentRequest,
  parseProviderPaymentSnapshot,
  parseReconcileResult,
  parseShareAttempt,
  parseShareCheckout,
  parseShareTarget,
  parsePayShareRequest,
  parseSharePaymentView
} from "./mercado-pago.js";

const id = "2e000000-0000-4000-8000-000000000001";
const other = "2e000000-0000-4000-8000-000000000002";
const token = "a".repeat(64);

const snapshot = {
  amountCents: 25_000,
  externalReference: id,
  providerPaymentId: "5550001",
  refundedCents: 0,
  status: "approved",
  statusDetail: "accredited",
  updatedAt: "2026-10-25T12:00:00.000Z"
};
const begin = {
  amountCents: 25_000,
  externalReference: id,
  fulfillment: "waiting",
  intentId: other,
  paymentId: id,
  refundedCents: 0,
  status: "created"
};

describe("Mercado Pago contracts", () => {
  it("accepts a provider snapshot and refuses extras, bad statuses and refunds above the amount", () => {
    expect(parseProviderPaymentSnapshot(snapshot)).toEqual(snapshot);
    expect(
      parseProviderPaymentSnapshot({ ...snapshot, statusDetail: null })
    ).toMatchObject({ statusDetail: null });
    for (const bad of [
      { ...snapshot, extra: 1 },
      { ...snapshot, status: "done" },
      { ...snapshot, amountCents: 0 },
      { ...snapshot, refundedCents: 25_001 },
      { ...snapshot, externalReference: "order-1" },
      { ...snapshot, providerPaymentId: "5/5" },
      { ...snapshot, updatedAt: "yesterday" },
      { ...snapshot, amountCents: 1.5 }
    ]) {
      expect(parseProviderPaymentSnapshot(bad)).toBeNull();
    }
  });

  it("parses what the database returns for an attempt and a reconciliation", () => {
    expect(parseBeginOnlinePaymentResult(begin)).toEqual(begin);
    expect(
      parseBeginOnlinePaymentResult({ ...begin, status: "paid" })
    ).toBeNull();
    const result = {
      amountCents: 25_000,
      fulfillment: "confirmed",
      intentId: other,
      orderId: other,
      outcome: "applied",
      paymentId: id,
      refundedCents: 0,
      status: "approved"
    };
    expect(parseReconcileResult(result)).toEqual(result);
    expect(parseReconcileResult({ ...result, orderId: null })).toMatchObject({
      orderId: null
    });
    expect(parseReconcileResult({ ...result, orderId: "x" })).toBeNull();
    expect(parseReconcileResult({ ...result, outcome: "maybe" })).toBeNull();
  });

  it("parses the view the diner polls", () => {
    const view = {
      intentId: id,
      intentStatus: "payment_pending",
      payment: {
        amountCents: 25_000,
        fulfillment: "waiting",
        paymentId: other,
        refundedCents: 0,
        status: "pending",
        statusDetail: null
      },
      totalCents: 25_000
    };
    expect(parseOnlinePaymentView(view)).toEqual(view);
    expect(parseOnlinePaymentView({ ...view, payment: null })).toMatchObject({
      payment: null
    });
    expect(
      parseOnlinePaymentView({ ...view, intentStatus: "rejected" })
    ).toBeNull();
    expect(
      parseOnlinePaymentView({
        ...view,
        payment: { ...view.payment, secret: 1 }
      })
    ).toBeNull();
  });

  it("identifies the diner by the table token only", () => {
    expect(isTableToken(token)).toBe(true);
    expect(isTableToken("A".repeat(64))).toBe(false);
    expect(parseDinerPaymentTarget({ intentId: id, token })).toEqual({
      intentId: id,
      token
    });
    expect(
      parseDinerPaymentTarget({ intentId: id, tenantId: id, token })
    ).toBeNull();
    expect(parseDinerPaymentTarget({ intentId: "x", token })).toBeNull();
  });

  it("accepts a sandbox outcome or a Bricks card form, nothing else", () => {
    expect(
      parsePayOnlinePaymentRequest({
        intentId: id,
        method: { kind: "sandbox", outcome: "rejected" },
        token
      })
    ).toMatchObject({ method: { kind: "sandbox", outcome: "rejected" } });
    const card = {
      installments: 1,
      issuerId: null,
      payerEmail: "ana@example.com",
      paymentMethodId: "visa",
      token: "cardtoken123456"
    };
    expect(
      parsePayOnlinePaymentRequest({
        intentId: id,
        method: { card, kind: "card" },
        token
      })
    ).toMatchObject({ method: { kind: "card" } });
    for (const method of [
      { kind: "sandbox", outcome: "refunded" },
      { amountCents: 1, kind: "sandbox", outcome: "approved" },
      { card: { ...card, number: "4111111111111111" }, kind: "card" },
      { card: { ...card, installments: 0 }, kind: "card" },
      { card: { ...card, payerEmail: "nope" }, kind: "card" },
      { card: { ...card, token: "x" }, kind: "card" },
      { kind: "cash" }
    ]) {
      expect(
        parsePayOnlinePaymentRequest({ intentId: id, method, token })
      ).toBeNull();
    }
  });

  it("parses a checkout and a connect result", () => {
    expect(
      parseOnlineCheckout({ mode: "sandbox", payment: begin, publicKey: null })
    ).toMatchObject({ mode: "sandbox" });
    expect(
      parseOnlineCheckout({ mode: "test", payment: begin, publicKey: null })
    ).toBeNull();
    expect(
      parseMercadoPagoConnectResult({
        authorizationUrl: "https://auth.example.test/x?y=1"
      })
    ).toEqual({ authorizationUrl: "https://auth.example.test/x?y=1" });
    expect(
      parseMercadoPagoConnectResult({ authorizationUrl: "javascript:alert(1)" })
    ).toBeNull();
  });

  it("validates the refund request and result", () => {
    const request = {
      amountCents: 4_000,
      commandId: id,
      paymentId: other,
      reason: " Se terminó "
    };
    expect(parseOnlineRefundRequest(request)).toEqual({
      ...request,
      reason: "Se terminó"
    });
    for (const bad of [
      { ...request, amountCents: 0 },
      { ...request, reason: " " },
      { ...request, reason: "x".repeat(201) },
      { ...request, providerPaymentId: "1" }
    ]) {
      expect(parseOnlineRefundRequest(bad)).toBeNull();
    }
    expect(
      parseOnlineRefundResult({ paymentId: id, refundedCents: 4_000 })
    ).toEqual({ paymentId: id, refundedCents: 4_000 });
    expect(
      parseOnlineRefundResult({ paymentId: id, pendingCents: 0 })
    ).toBeNull();
  });

  it("reads only what it needs from a notification and refuses malformed ones", () => {
    const body = {
      action: "payment.updated",
      api_version: "v1",
      data: { id: "5550001" },
      date_created: "2026-10-25T12:00:00Z",
      id: 123456,
      live_mode: false,
      type: "payment",
      user_id: "1234567"
    };
    expect(parseMercadoPagoNotification(body)).toEqual({
      dataId: "5550001",
      notificationId: "123456",
      topic: "payment",
      userId: "1234567"
    });
    expect(
      parseMercadoPagoNotification({ ...body, data: { id: 5550001 } })
    ).toMatchObject({ dataId: "5550001" });
    for (const bad of [
      null,
      {},
      { ...body, data: {} },
      { ...body, type: "Payment!" },
      { ...body, user_id: "abc" },
      { ...body, id: undefined },
      { ...body, data: { id: "a/b" } }
    ]) {
      expect(parseMercadoPagoNotification(bad)).toBeNull();
    }
  });
});

describe("share payments", () => {
  const secret = "S".repeat(43);
  it("validates the target and the payment method", () => {
    const target = { position: 2, secret, token };
    expect(parseShareTarget(target)).toEqual(target);
    expect(parseShareTarget({ ...target, position: 0 })).toBeNull();
    expect(parseShareTarget({ ...target, secret: "x" })).toBeNull();
    expect(parseShareTarget({ ...target, tenantId: id })).toBeNull();
    const sandbox = { kind: "sandbox", outcome: "approved" };
    expect(parsePayShareRequest({ ...target, method: sandbox })).toMatchObject({
      method: sandbox
    });
    expect(
      parsePayShareRequest({
        ...target,
        method: { kind: "sandbox", outcome: "paid" }
      })
    ).toBeNull();
    expect(
      parsePayShareRequest({
        ...target,
        method: { kind: "card", card: { number: "4111" } }
      })
    ).toBeNull();
  });

  it("parses an attempt, a checkout and a view", () => {
    const attempt = {
      amountCents: 8_250,
      externalReference: id,
      fulfillment: "waiting",
      paymentId: other,
      position: 2,
      refundedCents: 0,
      status: "created"
    };
    expect(parseShareAttempt(attempt)).toEqual(attempt);
    expect(parseShareAttempt({ ...attempt, intentId: id })).toBeNull();
    expect(
      parseShareCheckout({ mode: "sandbox", payment: attempt, publicKey: null })
    ).toMatchObject({ mode: "sandbox" });
    const payment = {
      amountCents: 8_250,
      fulfillment: "confirmed",
      paymentId: other,
      refundedCents: 0,
      status: "approved",
      statusDetail: null
    };
    expect(parseSharePaymentView({ payment, shareStatus: "paid" })).toEqual({
      payment,
      shareStatus: "paid"
    });
    expect(parseSharePaymentView({ payment: null, shareStatus: null })).toEqual(
      { payment: null, shareStatus: null }
    );
    expect(parseSharePaymentView({ payment, shareStatus: "gone" })).toBeNull();
  });

  it("accepts a reconciliation of a share, which has no intent", () => {
    const result = {
      amountCents: 8_250,
      fulfillment: "confirmed",
      intentId: null,
      orderId: null,
      outcome: "applied",
      paymentId: id,
      refundedCents: 0,
      status: "approved"
    };
    expect(parseReconcileResult(result)).toEqual(result);
    expect(parseReconcileResult({ ...result, intentId: "x" })).toBeNull();
  });
});
