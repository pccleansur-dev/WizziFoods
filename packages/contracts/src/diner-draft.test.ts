import { describe, expect, it } from "vitest";

import { parseDinerDraftRequest } from "./diner-draft.js";

const productId = "d1000000-0000-4000-8000-000000000001";
const variantId = "d2000000-0000-4000-8000-000000000002";
const lineId = "d3000000-0000-4000-8000-000000000003";
const token = "ab".repeat(32);

describe("diner draft contract", () => {
  it("accepts a private device selection without client prices", () => {
    expect(
      parseDinerDraftRequest({
        items: [{ lineId, productId, quantity: 2, variantId }],
        token
      })
    ).toEqual({
      items: [{ lineId, productId, quantity: 2, variantId }],
      token
    });
  });

  it.each([
    ["an injected tenant", { items: [], tenantId: crypto.randomUUID(), token }],
    [
      "a client price",
      {
        items: [
          { lineId, priceCents: 1, productId, quantity: 1, variantId: null }
        ],
        token
      }
    ],
    ["a malformed token", { items: [], token: "not-a-token" }],
    [
      "a zero quantity",
      { items: [{ lineId, productId, quantity: 0, variantId: null }], token }
    ],
    [
      "too many units",
      { items: [{ lineId, productId, quantity: 21, variantId: null }], token }
    ],
    [
      "a repeated line",
      {
        items: [
          { lineId, productId, quantity: 1, variantId: null },
          { lineId, productId, quantity: 1, variantId: null }
        ],
        token
      }
    ]
  ])("rejects %s", (_case, input) => {
    expect(parseDinerDraftRequest(input)).toBeNull();
  });
});
