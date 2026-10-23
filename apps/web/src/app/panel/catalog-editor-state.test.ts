import { describe, expect, it } from "vitest";

import {
  addCatalogCategory,
  addCatalogProduct,
  addCatalogSector,
  createEmptyCatalogDraft,
  formatPrice,
  parsePriceToCents,
  removeCatalogCategory
} from "./catalog-editor-state";

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003"
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
