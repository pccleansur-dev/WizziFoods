import { describe, expect, it } from "vitest";

import { parseOrderIntentRequest } from "./order-intent.js";

const base = {
  attribution: "table",
  commandId: "10000000-0000-4000-8000-000000000002",
  dinerName: "Valentín",
  items: [
    {
      lineId: "10000000-0000-4000-8000-000000000003",
      productId: "10000000-0000-4000-8000-000000000004",
      quantity: 2,
      variantId: null
    }
  ],
  paymentMethod: "cash",
  paymentPath: "in_person",
  seatLabel: null,
  token: "a".repeat(64)
} as const;

describe("parseOrderIntentRequest", () => {
  it("accepts a table intent with an optional seat", () => {
    expect(parseOrderIntentRequest(base)).toEqual(base);
  });

  it("requires a name and seat for individual attribution", () => {
    expect(
      parseOrderIntentRequest({ ...base, attribution: "individual" })
    ).toBeNull();
    expect(
      parseOrderIntentRequest({
        ...base,
        attribution: "individual",
        seatLabel: "Silla 2"
      })
    ).not.toBeNull();
  });

  it("rejects empty or oversized diner identity fields", () => {
    expect(parseOrderIntentRequest({ ...base, dinerName: " " })).toBeNull();
    expect(
      parseOrderIntentRequest({ ...base, seatLabel: "x".repeat(41) })
    ).toBeNull();
  });

  it("reuses the strict private-draft item rules", () => {
    expect(parseOrderIntentRequest({ ...base, items: [] })).toBeNull();
    expect(
      parseOrderIntentRequest({
        ...base,
        items: [{ ...base.items[0], quantity: 21 }]
      })
    ).toBeNull();
  });

  it("rejects client-controlled totals, scope and unknown fields", () => {
    expect(parseOrderIntentRequest({ ...base, totalCents: 1 })).toBeNull();
    expect(
      parseOrderIntentRequest({
        ...base,
        tenantId: "10000000-0000-4000-8000-000000000001"
      })
    ).toBeNull();
  });

  it("keeps Mercado Pago online and physical methods in person", () => {
    expect(
      parseOrderIntentRequest({
        ...base,
        paymentMethod: "mercado_pago",
        paymentPath: "online"
      })
    ).not.toBeNull();
    expect(
      parseOrderIntentRequest({ ...base, paymentPath: "online" })
    ).toBeNull();
    expect(
      parseOrderIntentRequest({ ...base, paymentMethod: "mercado_pago" })
    ).toBeNull();
  });
});
