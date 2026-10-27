import { describe, expect, it } from "vitest";

import {
  catalogPublicationIssues,
  explainCatalogDraft,
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

describe("automatic translations stay drafts until a person approves them", () => {
  const english = (title: string) => ({
    description: "",
    language: "en",
    title
  });
  const bilingual: CatalogDraft = {
    ...validDraft,
    categories: validDraft.categories.map((category) => ({
      ...category,
      content: [...category.content, english("Main dishes")]
    })),
    products: validDraft.products.map((product) => ({
      ...product,
      content: [...product.content, english("Milanese")],
      variants: product.variants.map((variant) => ({
        ...variant,
        content: [...variant.content, english("Neapolitan")]
      }))
    }))
  };
  const machine: CatalogDraft = {
    ...bilingual,
    products: bilingual.products.map((product) => ({
      ...product,
      content: product.content.map((item) =>
        item.language === "en" ? { ...item, review: "machine" as const } : item
      )
    }))
  };

  it("accepts the marker in a draft and keeps it", () => {
    expect(parseCatalogDraft(machine)).toEqual(machine);
  });

  it("rejects any other value or key in the content", () => {
    const bad = JSON.parse(JSON.stringify(machine));
    bad.products[0].content[1].review = "approved";
    expect(parseCatalogDraft(bad)).toBeNull();
    const extra = JSON.parse(JSON.stringify(bilingual));
    extra.products[0].content[0].price = 1;
    expect(parseCatalogDraft(extra)).toBeNull();
  });

  it("blocks publication while a machine translation is unreviewed", () => {
    expect(catalogPublicationIssues(bilingual, ["es", "en"])).toEqual([]);
    expect(catalogPublicationIssues(machine, ["es", "en"])).toEqual([
      "PENDING_TRANSLATION_REVIEW"
    ]);
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

describe("catalog drafts with unfinished translations", () => {
  const withBlankEnglish = JSON.parse(
    JSON.stringify(validDraft)
  ) as CatalogDraft;
  withBlankEnglish.categories[0]!.content.push({
    description: "",
    language: "en",
    title: ""
  });
  withBlankEnglish.products[0]!.content.push({
    description: "",
    language: "en",
    title: ""
  });

  it("saves a draft whose translations are still empty", () => {
    expect(parseCatalogDraft(withBlankEnglish)).not.toBeNull();
  });

  it("still refuses to publish until every language has a name", () => {
    expect(catalogPublicationIssues(withBlankEnglish, ["es", "en"])).toContain(
      "MISSING_LOCALIZED_CONTENT"
    );
    expect(catalogPublicationIssues(withBlankEnglish, ["es"])).toEqual([]);
  });
});

describe("explainCatalogDraft", () => {
  const clone = () => JSON.parse(JSON.stringify(validDraft)) as CatalogDraft;

  it("reports nothing for a valid draft", () => {
    expect(explainCatalogDraft(validDraft)).toEqual([]);
  });

  it("points at the entity, field and language of each problem", () => {
    const draft = clone();
    draft.products[0]!.content[0]!.title = "x".repeat(121);
    draft.sectors[0]!.name = "";
    draft.products[0]!.variants[0]!.priceDeltaCents = -5;
    expect(explainCatalogDraft(draft)).toEqual([
      {
        code: "MISSING_NAME",
        entity: "sector",
        field: "name",
        id: sectorId,
        index: 0,
        language: null
      },
      {
        code: "TOO_LONG",
        entity: "product",
        field: "title",
        id: productId,
        index: 0,
        language: "es"
      },
      {
        code: "INVALID_PRICE",
        entity: "variant",
        field: "priceDeltaCents",
        id: variantId,
        index: 0,
        language: null
      }
    ]);
  });

  it("flags unknown references and repeated positions", () => {
    const draft = clone();
    draft.products[0]!.categoryId = "c9000000-0000-4000-8000-000000000009";
    draft.products[0]!.sectorId = "c8000000-0000-4000-8000-000000000008";
    const codes = explainCatalogDraft(draft).map(({ code }) => code);
    expect(codes).toContain("UNKNOWN_CATEGORY");
    expect(codes).toContain("UNKNOWN_SECTOR");
  });

  it("explains every draft the contract refuses", () => {
    const broken: unknown[] = [
      null,
      "nope",
      { ...clone(), extra: 1 },
      { ...clone(), categories: "x" },
      (() => {
        const draft = clone();
        draft.products[0]!.priceCents = 1.5;
        return draft;
      })(),
      (() => {
        const draft = clone();
        draft.categories[0]!.content = [];
        return draft;
      })(),
      (() => {
        const draft = clone();
        draft.sectors[0]!.kind = "cellar" as never;
        return draft;
      })()
    ];
    for (const draft of broken) {
      expect(parseCatalogDraft(draft)).toBeNull();
      expect(explainCatalogDraft(draft).length).toBeGreaterThan(0);
    }
  });
});
