import type { CatalogDraft } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import { describeCatalogIssues } from "./catalog-issues";

const categoryId = "b1000000-0000-4000-8000-000000000001";
const productId = "b2000000-0000-4000-8000-000000000002";
const variantId = "b3000000-0000-4000-8000-000000000003";
const sectorId = "b4000000-0000-4000-8000-000000000004";

function draft(): CatalogDraft {
  return {
    baseRevision: null,
    categories: [
      {
        content: [
          { description: "", language: "es", title: "Pizzas" },
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
          { description: "", language: "es", title: "Nachos" },
          { description: "", language: "en", title: "" }
        ],
        id: productId,
        imageAssetId: null,
        position: 0,
        priceCents: 1500,
        sectorId,
        variants: [
          {
            content: [{ description: "", language: "es", title: "Doble" }],
            id: variantId,
            position: 0,
            priceDeltaCents: 100
          }
        ]
      }
    ],
    sectors: [{ id: sectorId, kind: "kitchen", name: "Cocina", position: 0 }]
  };
}

describe("describeCatalogIssues", () => {
  it("accepts unfinished translations and surrounding spaces, as saving does", () => {
    const value = draft();
    value.products[0]!.content[0]!.title = " Nachos ";
    expect(describeCatalogIssues(value)).toEqual([]);
  });

  it("says which product, field and language is wrong", () => {
    const value = draft();
    value.products[0]!.content[1]!.title = "x".repeat(121);
    const [issue] = describeCatalogIssues(value);
    expect(issue).toMatchObject({
      entity: "product",
      field: "title",
      id: productId,
      language: "en"
    });
    expect(issue?.label).toBe("Producto 1 «Nachos»");
    expect(issue?.message).toBe("el nombre en Inglés supera 120 caracteres");
  });

  it("names the parent product of a variant and the sector by its position", () => {
    const value = draft();
    value.products[0]!.variants[0]!.priceDeltaCents = -1;
    value.sectors[0]!.name = "";
    const issues = describeCatalogIssues(value);
    expect(issues.map(({ label, message }) => `${label}: ${message}`)).toEqual([
      "Sector 1: falta el nombre",
      "Variante 1 «Doble» de «Nachos»: el adicional no es válido"
    ]);
  });
});
