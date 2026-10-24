import { describe, expect, it } from "vitest";

import {
  draftStorageKey,
  parseDinerDraftQuoteResponse,
  parseStoredDraft
} from "./diner-draft";

const productId = "b1000000-0000-4000-8000-000000000001";
const lineId = "b2000000-0000-4000-8000-000000000002";

describe("private diner draft client", () => {
  it("uses a stable opaque storage key scoped to host and QR", () => {
    const key = draftStorageKey("bar.localhost", "ab".repeat(32));
    expect(key).toBe(draftStorageKey("bar.localhost", "ab".repeat(32)));
    expect(key).not.toContain("ab".repeat(32));
    expect(key).not.toBe(draftStorageKey("otro.localhost", "ab".repeat(32)));
  });

  it("loads only canonical selections from device storage", () => {
    const items = [{ lineId, productId, quantity: 2, variantId: null }];
    expect(parseStoredDraft(JSON.stringify(items))).toEqual(items);
    expect(parseStoredDraft("not-json")).toEqual([]);
    expect(
      parseStoredDraft(JSON.stringify([{ ...items[0], priceCents: 1 }]))
    ).toEqual([]);
  });

  it("accepts a server quote and rejects an invented total", () => {
    const quote = {
      canConfirm: false,
      catalogRevision: 3,
      items: [
        {
          lineId,
          productId,
          quantity: 2,
          status: "product_unavailable",
          title: "Milanesa",
          totalCents: 20_000,
          unitPriceCents: 10_000,
          variantId: null,
          variantTitle: null
        }
      ],
      totalCents: 20_000
    };
    expect(
      parseDinerDraftQuoteResponse({ data: { draft: quote, status: "ok" } })
    ).toEqual(quote);
    expect(
      parseDinerDraftQuoteResponse({
        data: { draft: { ...quote, totalCents: 1 }, status: "ok" }
      })
    ).toBeNull();
  });
});
