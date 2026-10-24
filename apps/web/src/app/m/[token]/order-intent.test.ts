import { describe, expect, it } from "vitest";

import {
  parseOrderIntentOptionsResponse,
  parseOrderIntentResponse
} from "./order-intent";

describe("order intent response parsers", () => {
  it("accepts only enabled server payment choices", () => {
    expect(
      parseOrderIntentOptionsResponse({
        data: {
          paymentMethods: [
            { method: "cash", paymentPath: "in_person" },
            { method: "mercado_pago", paymentPath: "online" }
          ]
        }
      })
    ).toEqual([
      { method: "cash", paymentPath: "in_person" },
      { method: "mercado_pago", paymentPath: "online" }
    ]);
    expect(
      parseOrderIntentOptionsResponse({
        data: { paymentMethods: [{ method: "cash", paymentPath: "online" }] }
      })
    ).toBeNull();
  });

  it("accepts a server-priced in-person result", () => {
    expect(
      parseOrderIntentResponse({
        data: {
          callId: "18000000-0000-4000-8000-000000000007",
          intentId: "18000000-0000-4000-8000-000000000006",
          items: [
            {
              lineId: "18000000-0000-4000-8000-000000000005",
              productId: "18000000-0000-4000-8000-000000000004",
              quantity: 2,
              status: "available",
              title: "Milanesa",
              totalCents: 25000,
              unitPriceCents: 12500,
              variantId: null,
              variantTitle: null
            }
          ],
          status: "awaiting_waiter",
          totalCents: 25000
        }
      })
    ).toMatchObject({ status: "awaiting_waiter", totalCents: 25000 });
  });

  it("rejects inconsistent totals and online results with calls", () => {
    expect(
      parseOrderIntentResponse({
        data: {
          callId: "18000000-0000-4000-8000-000000000007",
          intentId: "18000000-0000-4000-8000-000000000006",
          items: [],
          status: "payment_pending",
          totalCents: 1
        }
      })
    ).toBeNull();
  });
});
