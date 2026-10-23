import type { CatalogDraft } from "@platform/contracts";

type IdFactory = () => string;

export function createEmptyCatalogDraft(): CatalogDraft {
  return { baseRevision: null, categories: [], products: [], sectors: [] };
}

export function addCatalogCategory(
  draft: CatalogDraft,
  createId: IdFactory = () => crypto.randomUUID()
): CatalogDraft {
  return {
    ...draft,
    categories: [
      ...draft.categories,
      {
        content: [
          { description: "", language: "es", title: "Nueva categoría" }
        ],
        id: createId(),
        position: draft.categories.length
      }
    ]
  };
}

export function addCatalogSector(
  draft: CatalogDraft,
  createId: IdFactory = () => crypto.randomUUID()
): CatalogDraft {
  return {
    ...draft,
    sectors: [
      ...draft.sectors,
      {
        id: createId(),
        kind: "kitchen",
        name: "Cocina",
        position: draft.sectors.length
      }
    ]
  };
}

export function addCatalogProduct(
  draft: CatalogDraft,
  createId: IdFactory = () => crypto.randomUUID()
): CatalogDraft {
  const category = draft.categories[0];
  const sector = draft.sectors[0];
  if (!category || !sector) return draft;
  const position = draft.products.filter(
    ({ categoryId }) => categoryId === category.id
  ).length;
  return {
    ...draft,
    products: [
      ...draft.products,
      {
        categoryId: category.id,
        content: [{ description: "", language: "es", title: "Nuevo plato" }],
        id: createId(),
        imageAssetId: null,
        position,
        priceCents: 0,
        sectorId: sector.id,
        variants: []
      }
    ]
  };
}

export function removeCatalogCategory(
  draft: CatalogDraft,
  categoryId: string
): CatalogDraft {
  const categories = draft.categories
    .filter(({ id }) => id !== categoryId)
    .map((category, position) => ({ ...category, position }));
  return {
    ...draft,
    categories,
    products: draft.products.filter(
      ({ categoryId: value }) => value !== categoryId
    )
  };
}

export function normalizeProductPositions(draft: CatalogDraft): CatalogDraft {
  const nextByCategory = new Map<string, number>();
  return {
    ...draft,
    products: draft.products.map((product) => {
      const position = nextByCategory.get(product.categoryId) ?? 0;
      nextByCategory.set(product.categoryId, position + 1);
      return { ...product, position };
    })
  };
}

export function parsePriceToCents(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)(?:,\d{1,2})?$/u.test(value)) return null;
  const [units, decimals = ""] = value.split(",");
  const cents = Number(units) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 1_000_000_000 ? cents : null;
}

export function formatPrice(cents: number): string {
  const units = Math.floor(cents / 100);
  const decimals = cents % 100;
  return decimals
    ? `${units},${String(decimals).padStart(2, "0")}`
    : `${units}`;
}
