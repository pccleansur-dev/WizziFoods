export type CatalogSectorKind = "bar" | "kitchen" | "other";

export type LocalizedCatalogContent = {
  description: string;
  language: string;
  title: string;
};

export type CatalogCategory = {
  content: LocalizedCatalogContent[];
  id: string;
  position: number;
};

export type CatalogSector = {
  id: string;
  kind: CatalogSectorKind;
  name: string;
  position: number;
};

export type CatalogVariant = {
  content: LocalizedCatalogContent[];
  id: string;
  position: number;
  priceDeltaCents: number;
};

export type CatalogProduct = {
  categoryId: string;
  content: LocalizedCatalogContent[];
  id: string;
  imageAssetId: string | null;
  position: number;
  priceCents: number;
  sectorId: string;
  variants: CatalogVariant[];
};

export type CatalogDraft = {
  baseRevision: number | null;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  sectors: CatalogSector[];
};

export type CatalogPublicationIssue =
  | "MISSING_CATEGORY"
  | "MISSING_LOCALIZED_CONTENT"
  | "MISSING_PRODUCT"
  | "MISSING_SECTOR";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const languagePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[]
): boolean {
  return Object.keys(value).sort().join("\0") === expected.sort().join("\0");
}

function boundedString(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function position(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function money(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 1_000_000_000
  );
}

function parseContent(input: unknown): LocalizedCatalogContent[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 5) {
    return null;
  }
  const parsed: LocalizedCatalogContent[] = [];
  for (const value of input) {
    const candidate = record(value);
    if (
      !candidate ||
      !hasExactKeys(candidate, ["description", "language", "title"]) ||
      typeof candidate.language !== "string" ||
      !languagePattern.test(candidate.language) ||
      !boundedString(candidate.title, 1, 120) ||
      !boundedString(candidate.description, 0, 1_000)
    ) {
      return null;
    }
    parsed.push({
      description: candidate.description as string,
      language: candidate.language,
      title: candidate.title as string
    });
  }
  return new Set(parsed.map(({ language }) => language)).size === parsed.length
    ? parsed
    : null;
}

function uniquePositions(values: { position: number }[]): boolean {
  return (
    new Set(values.map(({ position: value }) => value)).size === values.length
  );
}

function hasLanguages(
  content: LocalizedCatalogContent[],
  languages: string[]
): boolean {
  return languages.every((language) =>
    content.some(
      (localized) =>
        localized.language === language && localized.title.trim().length > 0
    )
  );
}

export function catalogPublicationIssues(
  draft: CatalogDraft,
  languages: string[]
): CatalogPublicationIssue[] {
  const issues: CatalogPublicationIssue[] = [];
  if (draft.categories.length === 0) issues.push("MISSING_CATEGORY");
  if (draft.sectors.length === 0) issues.push("MISSING_SECTOR");
  if (draft.products.length === 0) issues.push("MISSING_PRODUCT");
  const localizedItems = [
    ...draft.categories,
    ...draft.products,
    ...draft.products.flatMap(({ variants }) => variants)
  ];
  if (
    localizedItems.some((item) => !hasLanguages(item.content, languages))
  ) {
    issues.push("MISSING_LOCALIZED_CONTENT");
  }
  return issues;
}

export function parseCatalogDraft(input: unknown): CatalogDraft | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, [
      "baseRevision",
      "categories",
      "products",
      "sectors"
    ]) ||
    !(
      candidate.baseRevision === null ||
      (Number.isSafeInteger(candidate.baseRevision) &&
        (candidate.baseRevision as number) > 0)
    ) ||
    !Array.isArray(candidate.categories) ||
    candidate.categories.length > 50 ||
    !Array.isArray(candidate.sectors) ||
    candidate.sectors.length > 20 ||
    !Array.isArray(candidate.products) ||
    candidate.products.length > 500
  ) {
    return null;
  }

  const categories: CatalogCategory[] = [];
  for (const value of candidate.categories) {
    const category = record(value);
    const content = category ? parseContent(category.content) : null;
    if (
      !category ||
      !hasExactKeys(category, ["content", "id", "position"]) ||
      !uuid(category.id) ||
      !position(category.position) ||
      !content
    ) {
      return null;
    }
    categories.push({ content, id: category.id, position: category.position });
  }

  const sectors: CatalogSector[] = [];
  for (const value of candidate.sectors) {
    const sector = record(value);
    if (
      !sector ||
      !hasExactKeys(sector, ["id", "kind", "name", "position"]) ||
      !uuid(sector.id) ||
      !position(sector.position) ||
      !boundedString(sector.name, 1, 80) ||
      (sector.kind !== "bar" &&
        sector.kind !== "kitchen" &&
        sector.kind !== "other")
    ) {
      return null;
    }
    sectors.push({
      id: sector.id,
      kind: sector.kind,
      name: sector.name as string,
      position: sector.position
    });
  }

  const categoryIds = new Set(categories.map(({ id }) => id));
  const sectorIds = new Set(sectors.map(({ id }) => id));
  if (
    categoryIds.size !== categories.length ||
    sectorIds.size !== sectors.length ||
    !uniquePositions(categories) ||
    !uniquePositions(sectors)
  ) {
    return null;
  }

  const products: CatalogProduct[] = [];
  const variantIds = new Set<string>();
  for (const value of candidate.products) {
    const product = record(value);
    const content = product ? parseContent(product.content) : null;
    if (
      !product ||
      !hasExactKeys(product, [
        "categoryId",
        "content",
        "id",
        "imageAssetId",
        "position",
        "priceCents",
        "sectorId",
        "variants"
      ]) ||
      !uuid(product.id) ||
      !uuid(product.categoryId) ||
      !categoryIds.has(product.categoryId) ||
      !uuid(product.sectorId) ||
      !sectorIds.has(product.sectorId) ||
      !(product.imageAssetId === null || uuid(product.imageAssetId)) ||
      !position(product.position) ||
      !money(product.priceCents) ||
      !content ||
      !Array.isArray(product.variants) ||
      product.variants.length > 30
    ) {
      return null;
    }

    const variants: CatalogVariant[] = [];
    for (const rawVariant of product.variants) {
      const variant = record(rawVariant);
      const variantContent = variant ? parseContent(variant.content) : null;
      if (
        !variant ||
        !hasExactKeys(variant, [
          "content",
          "id",
          "position",
          "priceDeltaCents"
        ]) ||
        !uuid(variant.id) ||
        variantIds.has(variant.id) ||
        !position(variant.position) ||
        !money(variant.priceDeltaCents) ||
        !variantContent
      ) {
        return null;
      }
      variantIds.add(variant.id);
      variants.push({
        content: variantContent,
        id: variant.id,
        position: variant.position,
        priceDeltaCents: variant.priceDeltaCents
      });
    }
    if (!uniquePositions(variants)) return null;
    products.push({
      categoryId: product.categoryId,
      content,
      id: product.id,
      imageAssetId: product.imageAssetId as string | null,
      position: product.position,
      priceCents: product.priceCents,
      sectorId: product.sectorId,
      variants
    });
  }

  if (
    new Set(products.map(({ id }) => id)).size !== products.length ||
    new Set(
      products.map(
        ({ categoryId, position: value }) => `${categoryId}:${value}`
      )
    ).size !== products.length
  ) {
    return null;
  }

  return {
    baseRevision: candidate.baseRevision as number | null,
    categories,
    products,
    sectors
  };
}
