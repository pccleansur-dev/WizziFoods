import { describe, expect, it } from "vitest";

import {
  catalogPublicationIssues,
  parseCatalogDraft,
  type CatalogDraft
} from "./catalog.js";

const categoryId = "c1000000-0000-4000-8000-000000000001";
const sectorId = "c2000000-0000-4000-8000-000000000002";
const productId = "c3000000-0000-4000-8000-000000000003";
const variantId = "c4000000-0000-4000-8000-000000000004";
const productContent = {
  description: "Con papas doradas.",
  language: "es",
  title: "Milanesa"
};

const validDraft: CatalogDraft = {
  baseRevision: null,
  categories: [
    {
      content: [{ description: "", language: "es", title: "Principales" }],
      id: categoryId,
      position: 0
    }
  ],
  products: [
    {
      categoryId,
      content: [productContent],
      id: productId,
      imageAssetId: null,
      position: 0,
      priceCents: 125000,
      sectorId,
      variants: [
        {
          content: [{ description: "", language: "es", title: "Napolitana" }],
          id: variantId,
          position: 0,
          priceDeltaCents: 25000
        }
      ]
    }
  ],
  sectors: [
    {
      id: sectorId,
      kind: "kitchen",
      name: "Cocina",
      position: 0
    }
  ]
};

describe("catalog draft contract", () => {
  it("accepts a canonical versioned menu draft", () => {
    expect(parseCatalogDraft(validDraft)).toEqual(validDraft);
  });

  it.each([
    ["availability mixed into the draft", { ...validDraft, isAvailable: true }],
    [
      "a product assigned to an unknown category",
      {
        ...validDraft,
        products: [
          { ...validDraft.products[0], categoryId: crypto.randomUUID() }
        ]
      }
    ],
    [
      "a product assigned to an unknown production sector",
      {
        ...validDraft,
        products: [{ ...validDraft.products[0], sectorId: crypto.randomUUID() }]
      }
    ],
    [
      "a fractional monetary amount",
      {
        ...validDraft,
        products: [{ ...validDraft.products[0], priceCents: 1250.5 }]
      }
    ],
    [
      "duplicate product positions inside a category",
      {
        ...validDraft,
        products: [
          validDraft.products[0],
          { ...validDraft.products[0], id: crypto.randomUUID() }
        ]
      }
    ],
    [
      "duplicate localized content",
      {
        ...validDraft,
        products: [
          {
            ...validDraft.products[0],
            content: [productContent, productContent]
          }
        ]
      }
    ]
  ])("rejects %s", (_case, input) => {
    expect(parseCatalogDraft(input)).toBeNull();
  });
});

describe("catalog publication readiness", () => {
  it("explains every missing structural requirement without blocking saves", () => {
    expect(
      catalogPublicationIssues(
        { baseRevision: null, categories: [], products: [], sectors: [] },
        ["es"]
      )
    ).toEqual(["MISSING_CATEGORY", "MISSING_SECTOR", "MISSING_PRODUCT"]);
  });

  it("requires reviewed titles for every configured language", () => {
    expect(catalogPublicationIssues(validDraft, ["es", "en"])).toEqual([
      "MISSING_LOCALIZED_CONTENT"
    ]);
  });

  it("accepts a complete multilingual catalog with variants", () => {
    const translated = {
      ...validDraft,
      categories: validDraft.categories.map((category) => ({
        ...category,
        content: [
          ...category.content,
          { description: "", language: "en", title: "Main dishes" }
        ]
      })),
      products: validDraft.products.map((product) => ({
        ...product,
        content: [
          ...product.content,
          {
            description: "With golden potatoes.",
            language: "en",
            title: "Milanese"
          }
        ],
        variants: product.variants.map((variant) => ({
          ...variant,
          content: [
            ...variant.content,
            { description: "", language: "en", title: "Neapolitan" }
          ]
        }))
      }))
    };

    expect(catalogPublicationIssues(translated, ["es", "en"])).toEqual([]);
  });
});
