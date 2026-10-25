import { describe, expect, it } from "vitest";

import {
  parseOnlineCheckoutResponse,
  parseOnlinePaymentResponse
} from "./online-payment";

const payment = {
  amountCents: 12_500,
  externalReference: "11111111-1111-4111-8111-111111111111",
  fulfillment: "waiting",
  intentId: "22222222-2222-4222-8222-222222222222",
  paymentId: "33333333-3333-4333-8333-333333333333",
  refundedCents: 0,
  status: "created"
};

describe("online payment API responses", () => {
  it("accepts the sandbox checkout without exposing a private credential", () => {
    expect(
      parseOnlineCheckoutResponse({
        data: { mode: "sandbox", payment, publicKey: null }
      })
    ).toEqual({ mode: "sandbox", payment, publicKey: null });
  });

  it("rejects extra response fields", () => {
    expect(
      parseOnlineCheckoutResponse({
        data: {
          mode: "live",
          payment,
          publicKey: "APP_USR-public",
          accessToken: "must-not-reach-the-browser"
        }
      })
    ).toBeNull();
  });

  it("accepts an authoritative pending payment view", () => {
    expect(
      parseOnlinePaymentResponse({
        data: {
          intentId: payment.intentId,
          intentStatus: "payment_pending",
          payment: {
            amountCents: 12_500,
            fulfillment: "waiting",
            paymentId: payment.paymentId,
            refundedCents: 0,
            status: "pending",
            statusDetail: "pending_waiting_payment"
          },
          totalCents: 12_500
        }
      })?.payment?.status
    ).toBe("pending");
  });
});
