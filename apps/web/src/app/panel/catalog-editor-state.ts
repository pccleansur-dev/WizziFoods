import type {
  CatalogDraft,
  LocalizedCatalogContent
} from "@platform/contracts";
import { newId } from "../../lib/new-id";

type IdFactory = () => string;

export function createEmptyCatalogDraft(): CatalogDraft {
  return { baseRevision: null, categories: [], products: [], sectors: [] };
}

export function addCatalogCategory(
  draft: CatalogDraft,
  createId: IdFactory = () => newId(),
  languages: string[] = ["es"]
): CatalogDraft {
  const content = synchronizeContent(
    [
      {
        description: "",
        language: languages[0] ?? "es",
        title: "Nueva categoría"
      }
    ],
    languages
  );
  return {
    ...draft,
    categories: [
      ...draft.categories,
      {
        content,
        id: createId(),
        position: draft.categories.length
      }
    ]
  };
}

export function addCatalogSector(
  draft: CatalogDraft,
  createId: IdFactory = () => newId()
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
  createId: IdFactory = () => newId(),
  languages: string[] = ["es"]
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
        content: synchronizeContent(
          [
            {
              description: "",
              language: languages[0] ?? "es",
              title: "Nuevo plato"
            }
          ],
          languages
        ),
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

/** The same text without the mark of an automatic translation. */
function withoutReview(item: LocalizedCatalogContent): LocalizedCatalogContent {
  return {
    description: item.description,
    language: item.language,
    title: item.title
  };
}

function localizedFallback(language: string): LocalizedCatalogContent {
  return {
    description: "",
    language,
    title: ""
  };
}

function synchronizeContent(
  content: LocalizedCatalogContent[],
  languages: string[]
): LocalizedCatalogContent[] {
  const configured = languages.filter(
    (language, index) => languages.indexOf(language) === index
  );
  return [
    ...content,
    ...configured
      .filter((language) => !content.some((item) => item.language === language))
      .map((language) => localizedFallback(language))
  ];
}

export function synchronizeCatalogLanguages(
  draft: CatalogDraft,
  languages: string[]
): CatalogDraft {
  return {
    ...draft,
    categories: draft.categories.map((category) => ({
      ...category,
      content: synchronizeContent(category.content, languages)
    })),
    products: draft.products.map((product) => ({
      ...product,
      content: synchronizeContent(product.content, languages),
      variants: product.variants.map((variant) => ({
        ...variant,
        content: synchronizeContent(variant.content, languages)
      }))
    }))
  };
}

export function addCatalogVariant(
  draft: CatalogDraft,
  productId: string,
  createId: IdFactory = () => newId(),
  languages: string[] = ["es"]
): CatalogDraft {
  const content = synchronizeContent(
    [
      {
        description: "",
        language: languages[0] ?? "es",
        title: "Nueva variante"
      }
    ],
    languages
  );
  return {
    ...draft,
    products: draft.products.map((product) =>
      product.id === productId
        ? {
            ...product,
            variants: [
              ...product.variants,
              {
                content,
                id: createId(),
                position: product.variants.length,
                priceDeltaCents: 0
              }
            ]
          }
        : product
    )
  };
}

export function removeCatalogVariant(
  draft: CatalogDraft,
  productId: string,
  variantId: string
): CatalogDraft {
  return {
    ...draft,
    products: draft.products.map((product) =>
      product.id === productId
        ? {
            ...product,
            variants: product.variants
              .filter(({ id }) => id !== variantId)
              .map((variant, position) => ({ ...variant, position }))
          }
        : product
    )
  };
}

export function updateCatalogLocalizedContent(
  draft: CatalogDraft,
  target: { id: string; type: "category" | "product" | "variant" },
  language: string,
  field: "description" | "title",
  value: string
): CatalogDraft {
  const update = (content: LocalizedCatalogContent[]) =>
    content.map((item) => {
      if (item.language !== language) return item;
      // A person editing the text is the review: the mark goes away.
      return { ...withoutReview(item), [field]: value };
    });
  if (target.type === "category") {
    return {
      ...draft,
      categories: draft.categories.map((category) =>
        category.id === target.id
          ? { ...category, content: update(category.content) }
          : category
      )
    };
  }
  return {
    ...draft,
    products: draft.products.map((product) => {
      if (target.type === "product" && product.id === target.id) {
        return { ...product, content: update(product.content) };
      }
      if (target.type === "variant") {
        return {
          ...product,
          variants: product.variants.map((variant) =>
            variant.id === target.id
              ? { ...variant, content: update(variant.content) }
              : variant
          )
        };
      }
      return product;
    })
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

type Json = Record<string, unknown>;

function plain(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function trimmed(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function trimContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((entry) => {
    const item = plain(entry);
    return item
      ? {
          ...item,
          description: trimmed(item.description),
          title: trimmed(item.title)
        }
      : entry;
  });
}

function mapList(value: unknown, change: (item: Json) => Json): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    const item = plain(entry);
    return item ? change(item) : entry;
  });
}

/**
 * Quita los espacios al borde de nombres y descripciones antes de validar: el
 * contrato rechaza el borrador entero por un espacio de más y el mensaje no dice
 * cuál. Lo que no reconoce lo deja igual para que el contrato lo rechace.
 */
export function trimCatalogText(input: unknown): unknown {
  const draft = plain(input);
  if (!draft) return input;
  return {
    ...draft,
    categories: mapList(draft.categories, (category) => ({
      ...category,
      content: trimContent(category.content)
    })),
    products: mapList(draft.products, (product) => ({
      ...product,
      content: trimContent(product.content),
      variants: mapList(product.variants, (variant) => ({
        ...variant,
        content: trimContent(variant.content)
      }))
    })),
    sectors: mapList(draft.sectors, (sector) => ({
      ...sector,
      name: trimmed(sector.name)
    }))
  };
}

type TranslationTarget = {
  content: LocalizedCatalogContent[];
  id: string;
  kind: "category" | "product" | "variant";
};

function translationTargets(draft: CatalogDraft): TranslationTarget[] {
  return [
    ...draft.categories.map(({ content, id }) => ({
      content,
      id,
      kind: "category" as const
    })),
    ...draft.products.flatMap((product) => [
      { content: product.content, id: product.id, kind: "product" as const },
      ...product.variants.map(({ content, id }) => ({
        content,
        id,
        kind: "variant" as const
      }))
    ])
  ];
}

/**
 * Textos que existen en el idioma de origen y todavía faltan en el destino. Lo
 * que una persona ya escribió nunca se vuelve a pedir. Las variantes no tienen
 * descripción.
 */
export function collectMissingTranslations(
  draft: CatalogDraft,
  sourceLanguage: string,
  targetLanguage: string
): { key: string; text: string }[] {
  const missing: { key: string; text: string }[] = [];
  for (const target of translationTargets(draft)) {
    const source = target.content.find(
      ({ language }) => language === sourceLanguage
    );
    const current = target.content.find(
      ({ language }) => language === targetLanguage
    );
    const fields: ("description" | "title")[] =
      target.kind === "variant" ? ["title"] : ["title", "description"];
    for (const field of fields) {
      const text = source?.[field].trim() ?? "";
      if (text && !(current?.[field].trim() ?? "")) {
        missing.push({ key: `${target.kind}:${target.id}:${field}`, text });
      }
    }
  }
  return missing;
}

/**
 * Vuelca las traducciones sólo en campos vacíos del idioma destino, sin pisar
 * lo escrito y sin tocar claves que no pertenecen al borrador.
 */
export function applyCatalogTranslations(
  draft: CatalogDraft,
  targetLanguage: string,
  translations: { key: string; text: string }[]
): CatalogDraft {
  const byKey = new Map(translations.map(({ key, text }) => [key, text]));
  const fill = (
    kind: TranslationTarget["kind"],
    id: string,
    content: LocalizedCatalogContent[]
  ): LocalizedCatalogContent[] => {
    const fields: ("description" | "title")[] =
      kind === "variant" ? ["title"] : ["title", "description"];
    if (!fields.some((field) => byKey.has(`${kind}:${id}:${field}`))) {
      return content;
    }
    const existing = content.find(
      ({ language }) => language === targetLanguage
    );
    const next = { ...(existing ?? localizedFallback(targetLanguage)) };
    let wrote = false;
    for (const field of fields) {
      const translated = byKey.get(`${kind}:${id}:${field}`);
      if (translated !== undefined && !next[field].trim()) {
        next[field] = translated;
        wrote = true;
      }
    }
    // What a machine wrote stays a draft until a person approves it.
    if (wrote) next.review = "machine";
    return existing
      ? content.map((item) => (item === existing ? next : item))
      : [...content, next];
  };
  return {
    ...draft,
    categories: draft.categories.map((category) => ({
      ...category,
      content: fill("category", category.id, category.content)
    })),
    products: draft.products.map((product) => ({
      ...product,
      content: fill("product", product.id, product.content),
      variants: product.variants.map((variant) => ({
        ...variant,
        content: fill("variant", variant.id, variant.content)
      }))
    }))
  };
}

const localizedLists = (draft: CatalogDraft): LocalizedCatalogContent[][] => [
  ...draft.categories.map(({ content }) => content),
  ...draft.products.map(({ content }) => content),
  ...draft.products.flatMap(({ variants }) =>
    variants.map(({ content }) => content)
  )
];

/** How many texts a machine wrote that nobody has approved yet. */
export function pendingTranslationReviews(draft: CatalogDraft): number {
  return localizedLists(draft)
    .flat()
    .filter(({ review }) => review === "machine").length;
}

/** The administrator read the automatic translations and accepts them as they are. */
export function approveCatalogTranslations(draft: CatalogDraft): CatalogDraft {
  const approve = (content: LocalizedCatalogContent[]) =>
    content.map(withoutReview);
  return {
    ...draft,
    categories: draft.categories.map((category) => ({
      ...category,
      content: approve(category.content)
    })),
    products: draft.products.map((product) => ({
      ...product,
      content: approve(product.content),
      variants: product.variants.map((variant) => ({
        ...variant,
        content: approve(variant.content)
      }))
    }))
  };
}
