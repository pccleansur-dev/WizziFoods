import { describe, expect, it, vi } from "vitest";

import { DinerDraftService } from "./diner-draft.service.js";

const token = "ab".repeat(32);
const categoryId = "d1000000-0000-4000-8000-000000000001";
const productId = "d2000000-0000-4000-8000-000000000002";
const variantId = "d3000000-0000-4000-8000-000000000003";
const lineId = "d4000000-0000-4000-8000-000000000004";
const context = {
  location: { id: "d5000000-0000-4000-8000-000000000005" },
  tenant: { id: "d6000000-0000-4000-8000-000000000006" }
} as never;

const catalog = {
  availability: {},
  catalog: {
    baseRevision: null,
    categories: [],
    products: [
      {
        categoryId,
        content: [
          { description: "Con papas", language: "es", title: "Milanesa" }
        ],
        id: productId,
        imageAssetId: null,
        position: 0,
        priceCents: 12_500,
        sectorId: crypto.randomUUID(),
        variants: [
          {
            content: [{ description: "", language: "es", title: "Napolitana" }],
            id: variantId,
            position: 0,
            priceDeltaCents: 2_500
          }
        ]
      }
    ],
    sectors: []
  },
  publishedAt: new Date().toISOString(),
  revision: 7
};

function service(
  entry: unknown = {
    entry: { canConfirmOrder: true },
    status: "ok"
  },
  current: unknown = catalog
) {
  return new DinerDraftService(
    { resolve: vi.fn().mockResolvedValue(entry) } as never,
    { getCurrent: vi.fn().mockResolvedValue(current) } as never
  );
}

describe("DinerDraftService", () => {
  it("recalculates variants, quantities and totals from the published catalog", async () => {
    await expect(
      service().recalculate(context, {
        items: [{ lineId, productId, quantity: 2, variantId }],
        token
      })
    ).resolves.toEqual({
      draft: {
        canConfirm: true,
        catalogRevision: 7,
        items: [
          {
            lineId,
            productId,
            quantity: 2,
            status: "available",
            title: "Milanesa",
            totalCents: 30_000,
            unitPriceCents: 15_000,
            variantId,
            variantTitle: "Napolitana"
          }
        ],
        totalCents: 30_000
      },
      status: "ok"
    });
  });

  it("marks a newly disabled product and blocks confirmation", async () => {
    const current = {
      ...catalog,
      availability: { [productId]: { isAvailable: false, version: 2 } }
    };
    const result = await service(undefined, current).recalculate(context, {
      items: [{ lineId, productId, quantity: 1, variantId: null }],
      token
    });
    expect(result).toMatchObject({
      draft: {
        canConfirm: false,
        items: [{ status: "product_unavailable" }],
        totalCents: 12_500
      },
      status: "ok"
    });
  });

  it("blocks a removed variant without trusting its former price", async () => {
    const result = await service().recalculate(context, {
      items: [
        { lineId, productId, quantity: 1, variantId: crypto.randomUUID() }
      ],
      token
    });
    expect(result).toMatchObject({
      draft: {
        canConfirm: false,
        items: [
          { status: "variant_missing", totalCents: 0, unitPriceCents: 0 }
        ],
        totalCents: 0
      }
    });
  });

  it("lets a view-only table keep a priced draft but not confirm it", async () => {
    const result = await service({
      entry: { canConfirmOrder: false },
      status: "ok"
    }).recalculate(context, {
      items: [{ lineId, productId, quantity: 1, variantId: null }],
      token
    });
    expect(result).toMatchObject({
      draft: { canConfirm: false, totalCents: 12_500 },
      status: "ok"
    });
  });

  it.each(["invalid", "unavailable"] as const)(
    "does not quote a %s table entry",
    async (status) => {
      await expect(
        service({ status }).recalculate(context, { items: [], token })
      ).resolves.toEqual({ status });
    }
  );
});
