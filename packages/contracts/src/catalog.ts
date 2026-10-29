export type CatalogSectorKind = "bar" | "kitchen" | "other";

export type LocalizedCatalogContent = {
  description: string;
  language: string;
  /**
   * Present only in a draft, on text a machine wrote: it stays a draft until a person
   * approves it, and a catalog with any of it cannot be published.
   */
  review?: "machine";
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
  | "MISSING_SECTOR"
  | "PENDING_TRANSLATION_REVIEW";

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

/** The text keys, plus the optional draft-only mark of an automatic translation. */
function hasContentKeys(value: Record<string, unknown>): boolean {
  if ("review" in value) {
    return (
      value.review === "machine" &&
      hasExactKeys(value, ["description", "language", "review", "title"])
    );
  }
  return hasExactKeys(value, ["description", "language", "title"]);
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
      !hasContentKeys(candidate) ||
      typeof candidate.language !== "string" ||
      !languagePattern.test(candidate.language) ||
      !boundedString(candidate.title, 0, 120) ||
      !boundedString(candidate.description, 0, 1_000)
    ) {
      return null;
    }
    parsed.push({
      description: candidate.description as string,
      language: candidate.language,
      ...(candidate.review === "machine" ? { review: "machine" as const } : {}),
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
  if (localizedItems.some((item) => !hasLanguages(item.content, languages))) {
    issues.push("MISSING_LOCALIZED_CONTENT");
  }
  if (
    localizedItems.some((item) =>
      item.content.some(({ review }) => review === "machine")
    )
  ) {
    issues.push("PENDING_TRANSLATION_REVIEW");
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

export type CatalogDraftIssueCode =
  | "DUPLICATE_ID"
  | "DUPLICATE_LANGUAGE"
  | "DUPLICATE_POSITION"
  | "INVALID_ID"
  | "INVALID_KIND"
  | "INVALID_LANGUAGE"
  | "INVALID_POSITION"
  | "INVALID_PRICE"
  | "INVALID_STRUCTURE"
  | "LIMIT_EXCEEDED"
  | "MISSING_CONTENT"
  | "MISSING_NAME"
  | "TOO_LONG"
  | "UNKNOWN_CATEGORY"
  | "UNKNOWN_SECTOR"
  | "UNTRIMMED";

export type CatalogDraftIssue = {
  code: CatalogDraftIssueCode;
  entity: "category" | "draft" | "product" | "sector" | "variant";
  field: string;
  /** Identificador de la entidad afectada, si el borrador lo trae válido. */
  id: string | null;
  /** Posición (desde 0) de la entidad dentro de su lista. */
  index: number | null;
  language: string | null;
};

/**
 * Explica por qué `parseCatalogDraft` rechaza un borrador: devuelve cada
 * problema con la entidad, el campo y el idioma. Recorre en el mismo orden que
 * la pantalla: categorías, sectores y productos con sus variantes. Siempre
 * devuelve al menos un problema si el borrador no es válido.
 */
export function explainCatalogDraft(input: unknown): CatalogDraftIssue[] {
  const issues: CatalogDraftIssue[] = [];
  const add = (
    code: CatalogDraftIssueCode,
    entity: CatalogDraftIssue["entity"],
    field: string,
    id: unknown,
    index: number | null,
    language: string | null = null
  ) =>
    issues.push({
      code,
      entity,
      field,
      id: uuid(id) ? id : null,
      index,
      language
    });

  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["baseRevision", "categories", "products", "sectors"])
  ) {
    add("INVALID_STRUCTURE", "draft", "draft", null, null);
    return issues;
  }
  if (!(
    root.baseRevision === null ||
    (Number.isSafeInteger(root.baseRevision) &&
      (root.baseRevision as number) > 0)
  )) {
    add("INVALID_STRUCTURE", "draft", "baseRevision", null, null);
  }
  const lists = [
    ["categories", "category", 50],
    ["sectors", "sector", 20],
    ["products", "product", 500]
  ] as const;
  for (const [key, entity, max] of lists) {
    const list = root[key];
    if (!Array.isArray(list)) {
      add("INVALID_STRUCTURE", "draft", key, null, null);
    } else if (list.length > max) {
      add("LIMIT_EXCEEDED", entity, key, null, null);
    }
  }
  if (
    !Array.isArray(root.categories) ||
    !Array.isArray(root.sectors) ||
    !Array.isArray(root.products)
  ) {
    return issues;
  }

  const checkContent = (
    value: unknown,
    entity: CatalogDraftIssue["entity"],
    id: unknown,
    index: number,
    withDescription: boolean
  ) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
      add("MISSING_CONTENT", entity, "content", id, index);
      return;
    }
    const languages = new Set<string>();
    for (const entry of value) {
      const item = record(entry);
      const language =
        item && typeof item.language === "string" ? item.language : null;
      if (
        !item ||
        !hasContentKeys(item) ||
        language === null ||
        !languagePattern.test(language)
      ) {
        add("INVALID_LANGUAGE", entity, "content", id, index, language);
        continue;
      }
      if (languages.has(language)) {
        add("DUPLICATE_LANGUAGE", entity, "content", id, index, language);
      }
      languages.add(language);
      const fields: [string, number][] = [["title", 120]];
      if (withDescription) fields.push(["description", 1_000]);
      for (const [field, max] of fields) {
        const text = item[field];
        if (typeof text !== "string") {
          add("INVALID_STRUCTURE", entity, field, id, index, language);
        } else if (text !== text.trim()) {
          add("UNTRIMMED", entity, field, id, index, language);
        } else if (text.length > max) {
          add("TOO_LONG", entity, field, id, index, language);
        }
      }
    }
  };

  const seenIds = new Set<string>();
  const checkId = (
    item: Record<string, unknown>,
    entity: CatalogDraftIssue["entity"],
    index: number
  ) => {
    if (!uuid(item.id)) add("INVALID_ID", entity, "id", null, index);
    else if (seenIds.has(item.id)) {
      add("DUPLICATE_ID", entity, "id", item.id, index);
    } else seenIds.add(item.id);
  };
  const checkPosition = (
    item: Record<string, unknown>,
    entity: CatalogDraftIssue["entity"],
    index: number,
    positions: Set<string>,
    scope = ""
  ) => {
    if (!position(item.position)) {
      add("INVALID_POSITION", entity, "position", item.id, index);
      return;
    }
    const marker = `${scope}:${item.position}`;
    if (positions.has(marker)) {
      add("DUPLICATE_POSITION", entity, "position", item.id, index);
    }
    positions.add(marker);
  };

  const categoryIds = new Set<string>();
  const categoryPositions = new Set<string>();
  root.categories.forEach((value, index) => {
    const category = record(value);
    if (!category || !hasExactKeys(category, ["content", "id", "position"])) {
      add("INVALID_STRUCTURE", "category", "category", null, index);
      return;
    }
    checkId(category, "category", index);
    if (uuid(category.id)) categoryIds.add(category.id);
    checkPosition(category, "category", index, categoryPositions);
    checkContent(category.content, "category", category.id, index, true);
  });

  const sectorIds = new Set<string>();
  const sectorPositions = new Set<string>();
  root.sectors.forEach((value, index) => {
    const sector = record(value);
    if (!sector || !hasExactKeys(sector, ["id", "kind", "name", "position"])) {
      add("INVALID_STRUCTURE", "sector", "sector", null, index);
      return;
    }
    checkId(sector, "sector", index);
    if (uuid(sector.id)) sectorIds.add(sector.id);
    checkPosition(sector, "sector", index, sectorPositions);
    if (!["bar", "kitchen", "other"].includes(String(sector.kind))) {
      add("INVALID_KIND", "sector", "kind", sector.id, index);
    }
    if (typeof sector.name !== "string" || sector.name.length === 0) {
      add("MISSING_NAME", "sector", "name", sector.id, index);
    } else if (sector.name !== sector.name.trim()) {
      add("UNTRIMMED", "sector", "name", sector.id, index);
    } else if (sector.name.length > 80) {
      add("TOO_LONG", "sector", "name", sector.id, index);
    }
  });

  const productPositions = new Set<string>();
  root.products.forEach((value, index) => {
    const product = record(value);
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
      ])
    ) {
      add("INVALID_STRUCTURE", "product", "product", null, index);
      return;
    }
    checkId(product, "product", index);
    checkPosition(
      product,
      "product",
      index,
      productPositions,
      String(product.categoryId)
    );
    if (!uuid(product.categoryId) || !categoryIds.has(product.categoryId)) {
      add("UNKNOWN_CATEGORY", "product", "categoryId", product.id, index);
    }
    if (!uuid(product.sectorId) || !sectorIds.has(product.sectorId)) {
      add("UNKNOWN_SECTOR", "product", "sectorId", product.id, index);
    }
    if (!(product.imageAssetId === null || uuid(product.imageAssetId))) {
      add("INVALID_ID", "product", "imageAssetId", product.id, index);
    }
    if (!money(product.priceCents)) {
      add("INVALID_PRICE", "product", "priceCents", product.id, index);
    }
    checkContent(product.content, "product", product.id, index, true);
    if (!Array.isArray(product.variants) || product.variants.length > 30) {
      add("LIMIT_EXCEEDED", "product", "variants", product.id, index);
      return;
    }
    const variantPositions = new Set<string>();
    product.variants.forEach((rawVariant, variantIndex) => {
      const variant = record(rawVariant);
      if (
        !variant ||
        !hasExactKeys(variant, ["content", "id", "position", "priceDeltaCents"])
      ) {
        add("INVALID_STRUCTURE", "variant", "variant", null, variantIndex);
        return;
      }
      checkId(variant, "variant", variantIndex);
      checkPosition(variant, "variant", variantIndex, variantPositions);
      if (!money(variant.priceDeltaCents)) {
        add(
          "INVALID_PRICE",
          "variant",
          "priceDeltaCents",
          variant.id,
          variantIndex
        );
      }
      checkContent(variant.content, "variant", variant.id, variantIndex, false);
    });
  });

  if (issues.length === 0 && parseCatalogDraft(input) === null) {
    add("INVALID_STRUCTURE", "draft", "draft", null, null);
  }
  return issues;
}

/** The id of a product photo as the public image address accepts it, or null. */
export function parseCatalogImageAssetId(value: unknown): string | null {
  return uuid(value) ? value.toLowerCase() : null;
}

/**
 * The same-origin address of a published product photo. It names only the photo: the
 * restaurant is always the one of the host that asks.
 */
export function catalogImagePath(assetId: string): string {
  return `/api/catalog/image/${assetId}`;
}
