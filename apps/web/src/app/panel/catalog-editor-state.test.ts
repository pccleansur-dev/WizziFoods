import { parseCatalogDraft } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import {
  addCatalogCategory,
  addCatalogProduct,
  addCatalogSector,
  addCatalogVariant,
  createEmptyCatalogDraft,
  applyCatalogTranslations,
  approveCatalogTranslations,
  pendingTranslationReviews,
  collectMissingTranslations,
  formatPrice,
  trimCatalogText,
  parsePriceToCents,
  removeCatalogCategory,
  removeCatalogVariant,
  synchronizeCatalogLanguages,
  updateCatalogLocalizedContent
} from "./catalog-editor-state";

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
  "40000000-0000-4000-8000-000000000004",
  "50000000-0000-4000-8000-000000000005"
];

describe("catalog editor state", () => {
  it("builds a canonical empty draft", () => {
    expect(createEmptyCatalogDraft()).toEqual({
      baseRevision: null,
      categories: [],
      products: [],
      sectors: []
    });
  });

  it("adds related categories, sectors and products with stable positions", () => {
    let cursor = 0;
    const nextId = () => ids[cursor++]!;
    let draft = addCatalogCategory(createEmptyCatalogDraft(), nextId);
    draft = addCatalogSector(draft, nextId);
    draft = addCatalogProduct(draft, nextId);

    expect(draft.categories[0]?.position).toBe(0);
    expect(draft.sectors[0]?.position).toBe(0);
    expect(draft.products[0]).toMatchObject({
      categoryId: ids[0],
      position: 0,
      priceCents: 0,
      sectorId: ids[1]
    });
  });

  it("does not add a product until category and sector exist", () => {
    expect(addCatalogProduct(createEmptyCatalogDraft(), () => ids[0]!)).toEqual(
      createEmptyCatalogDraft()
    );
  });

  it("removes the products that belong to a removed category", () => {
    let cursor = 0;
    const nextId = () => ids[cursor++]!;
    let draft = addCatalogCategory(createEmptyCatalogDraft(), nextId);
    draft = addCatalogSector(draft, nextId);
    draft = addCatalogProduct(draft, nextId);

    expect(removeCatalogCategory(draft, ids[0]!)).toMatchObject({
      categories: [],
      products: []
    });
  });

  it("adds and removes ordered variants without changing the base price", () => {
    let cursor = 0;
    const nextId = () => ids[cursor++]!;
    let draft = addCatalogCategory(createEmptyCatalogDraft(), nextId);
    draft = addCatalogSector(draft, nextId);
    draft = addCatalogProduct(draft, nextId);
    draft = addCatalogVariant(draft, ids[2]!, nextId, ["es", "en"]);
    draft = addCatalogVariant(draft, ids[2]!, nextId, ["es", "en"]);

    expect(draft.products[0]).toMatchObject({
      priceCents: 0,
      variants: [
        {
          content: [
            { description: "", language: "es", title: "Nueva variante" },
            { description: "", language: "en", title: "" }
          ],
          id: ids[3],
          position: 0,
          priceDeltaCents: 0
        },
        { id: ids[4], position: 1 }
      ]
    });

    expect(removeCatalogVariant(draft, ids[2]!, ids[3]!)).toMatchObject({
      products: [{ variants: [{ id: ids[4], position: 0 }] }]
    });
  });

  it("adds configured languages as reviewable drafts and edits one locale", () => {
    let cursor = 0;
    const nextId = () => ids[cursor++]!;
    let draft = addCatalogCategory(createEmptyCatalogDraft(), nextId);
    draft = addCatalogSector(draft, nextId);
    draft = addCatalogProduct(draft, nextId);

    draft = synchronizeCatalogLanguages(draft, ["es", "en"]);
    draft = updateCatalogLocalizedContent(
      draft,
      { id: ids[2]!, type: "product" },
      "en",
      "title",
      "Milanese"
    );

    expect(draft.categories[0]?.content).toEqual([
      { description: "", language: "es", title: "Nueva categoría" },
      { description: "", language: "en", title: "" }
    ]);
    expect(draft.products[0]?.content).toEqual([
      { description: "", language: "es", title: "Nuevo plato" },
      { description: "", language: "en", title: "Milanese" }
    ]);
  });

  it("creates categories and products with every configured language editable", () => {
    let cursor = 0;
    const nextId = () => ids[cursor++]!;
    let draft = addCatalogCategory(createEmptyCatalogDraft(), nextId, [
      "es",
      "en"
    ]);
    draft = addCatalogSector(draft, nextId);
    draft = addCatalogProduct(draft, nextId, ["es", "en"]);

    expect(
      draft.categories[0]?.content.map(({ language }) => language)
    ).toEqual(["es", "en"]);
    expect(draft.products[0]?.content.map(({ language }) => language)).toEqual([
      "es",
      "en"
    ]);
    expect(draft.products[0]?.content[1]?.title).toBe("");
  });

  it.each([
    ["12500", 1_250_000],
    ["12500,50", 1_250_050],
    ["0", 0],
    ["-1", null],
    ["12,345", null],
    ["texto", null]
  ])("parses an Argentine price %s", (value, expected) => {
    expect(parsePriceToCents(value)).toBe(expected);
  });

  it("formats cents without hiding decimals", () => {
    expect(formatPrice(1_250_050)).toBe("12500,50");
    expect(formatPrice(1_250_000)).toBe("12500");
  });
});

describe("trimCatalogText", () => {
  const withSpaces = {
    baseRevision: null,
    categories: [
      {
        content: [{ description: " rico ", language: "es", title: " Platos " }],
        id: "a1000000-0000-4000-8000-000000000001",
        position: 0
      }
    ],
    products: [
      {
        categoryId: "a1000000-0000-4000-8000-000000000001",
        content: [{ description: "", language: "es", title: "Milanesa " }],
        id: "a2000000-0000-4000-8000-000000000002",
        imageAssetId: null,
        position: 0,
        priceCents: 1000,
        sectorId: "a3000000-0000-4000-8000-000000000003",
        variants: [
          {
            content: [{ description: "", language: "es", title: " Doble" }],
            id: "a4000000-0000-4000-8000-000000000004",
            position: 0,
            priceDeltaCents: 100
          }
        ]
      }
    ],
    sectors: [
      {
        id: "a3000000-0000-4000-8000-000000000003",
        kind: "kitchen",
        name: " Cocina ",
        position: 0
      }
    ]
  };

  it("removes the spaces around names and descriptions the contract refuses", () => {
    const trimmed = trimCatalogText(withSpaces) as typeof withSpaces;
    expect(trimmed.categories[0]?.content[0]).toMatchObject({
      description: "rico",
      title: "Platos"
    });
    expect(trimmed.products[0]?.content[0]?.title).toBe("Milanesa");
    expect(trimmed.products[0]?.variants[0]?.content[0]?.title).toBe("Doble");
    expect(trimmed.sectors[0]?.name).toBe("Cocina");
    expect(parseCatalogDraft(trimmed)).not.toBeNull();
    expect(parseCatalogDraft(withSpaces)).toBeNull();
  });

  it("leaves anything it does not understand for the contract to reject", () => {
    expect(trimCatalogText("nope")).toBe("nope");
    expect(trimCatalogText({ categories: "x" })).toEqual({ categories: "x" });
  });
});

describe("catalog translation helpers", () => {
  const categoryId = "b1000000-0000-4000-8000-000000000001";
  const productId = "b2000000-0000-4000-8000-000000000002";
  const variantId = "b3000000-0000-4000-8000-000000000003";
  const sectorId = "b4000000-0000-4000-8000-000000000004";
  const base = {
    baseRevision: null,
    categories: [
      {
        content: [
          { description: "", language: "es", title: "Platos" },
          { description: "", language: "en", title: "" }
        ],
        id: categoryId,
        position: 0
      }
    ],
    products: [
      {
        categoryId,
        content: [
          { description: "Con papas", language: "es", title: "Milanesa" },
          { description: "", language: "en", title: "" }
        ],
        id: productId,
        imageAssetId: null,
        position: 0,
        priceCents: 100,
        sectorId,
        variants: [
          {
            content: [{ description: "", language: "es", title: "Doble" }],
            id: variantId,
            position: 0,
            priceDeltaCents: 10
          }
        ]
      }
    ],
    sectors: [
      { id: sectorId, kind: "kitchen" as const, name: "Cocina", position: 0 }
    ]
  };

  it("collects only what has a source text and no target text", () => {
    expect(collectMissingTranslations(base, "es", "en")).toEqual([
      { key: `category:${categoryId}:title`, text: "Platos" },
      { key: `product:${productId}:title`, text: "Milanesa" },
      { key: `product:${productId}:description`, text: "Con papas" },
      { key: `variant:${variantId}:title`, text: "Doble" }
    ]);
  });

  it("never asks to translate what a person already wrote", () => {
    const written = JSON.parse(JSON.stringify(base));
    written.products[0].content[1].title = "Milanese";
    const keys = collectMissingTranslations(written, "es", "en").map(
      ({ key }) => key
    );
    expect(keys).not.toContain(`product:${productId}:title`);
    expect(keys).toContain(`product:${productId}:description`);
  });

  it("applies translations only into empty targets and creates missing language entries", () => {
    const written = JSON.parse(JSON.stringify(base));
    written.products[0].content[1].title = "Milanese";
    const result = applyCatalogTranslations(written, "en", [
      { key: `category:${categoryId}:title`, text: "Dishes" },
      { key: `product:${productId}:title`, text: "SHOULD NOT OVERWRITE" },
      { key: `product:${productId}:description`, text: "With fries" },
      { key: `variant:${variantId}:title`, text: "Double" }
    ]);
    expect(result.categories[0]?.content[1]?.title).toBe("Dishes");
    expect(result.products[0]?.content[1]?.title).toBe("Milanese");
    expect(result.products[0]?.content[1]?.description).toBe("With fries");
    expect(
      result.products[0]?.variants[0]?.content.find((c) => c.language === "en")
        ?.title
    ).toBe("Double");
    expect(base.categories[0]?.content[1]?.title).toBe("");
  });

  it("marks what it wrote as an automatic translation to review, and only that", () => {
    const written = JSON.parse(JSON.stringify(base));
    written.products[0].content[1].title = "Milanese";
    const result = applyCatalogTranslations(written, "en", [
      { key: `product:${productId}:title`, text: "SHOULD NOT OVERWRITE" },
      { key: `product:${productId}:description`, text: "With fries" }
    ]);
    // The person's own title stays theirs; the description the machine wrote is flagged.
    expect(result.products[0]?.content[1]?.title).toBe("Milanese");
    expect(result.products[0]?.content[1]?.review).toBe("machine");
    expect(result.products[0]?.content[0]?.review).toBeUndefined();
    expect(result.products[0]?.priceCents).toBe(written.products[0].priceCents);
  });

  it("clears the mark when a person edits or approves the text", () => {
    const translated = applyCatalogTranslations(base, "en", [
      { key: `product:${productId}:title`, text: "Milanese" }
    ]);
    expect(pendingTranslationReviews(translated)).toBe(1);
    const approved = approveCatalogTranslations(translated);
    expect(pendingTranslationReviews(approved)).toBe(0);
    expect(approved.products[0]?.content[1]?.title).toBe("Milanese");
    expect(translated.products[0]?.content[1]?.review).toBe("machine");
  });

  it("ignores keys that do not belong to the draft", () => {
    const result = applyCatalogTranslations(base, "en", [
      { key: "product:ffffffff-ffff-4fff-8fff-ffffffffffff:title", text: "x" }
    ]);
    expect(result).toEqual(base);
  });
});
