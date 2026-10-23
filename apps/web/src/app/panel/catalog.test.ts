import { describe, expect, it } from "vitest";

import { parseCatalogDraftResponse } from "./catalog";

const draft = {
  baseRevision: null,
  categories: [
    {
      content: [{ description: "", language: "es", title: "Entradas" }],
      id: "10000000-0000-4000-8000-000000000001",
      position: 0
    }
  ],
  products: [],
  sectors: [
    {
      id: "20000000-0000-4000-8000-000000000002",
      kind: "kitchen",
      name: "Cocina",
      position: 0
    }
  ]
};

describe("catalog draft response", () => {
  it("accepts a canonical saved draft", () => {
    expect(
      parseCatalogDraftResponse({
        data: {
          basePublishedRevision: null,
          draft,
          isDirty: true,
          revision: 3,
          updatedAt: "2026-10-23T15:30:00.000Z"
        }
      })
    ).toEqual({
      basePublishedRevision: null,
      draft,
      isDirty: true,
      revision: 3,
      updatedAt: "2026-10-23T15:30:00.000Z"
    });
  });

  it("accepts an empty first-time catalog", () => {
    expect(parseCatalogDraftResponse({ data: null })).toBeNull();
  });

  it.each([
    {},
    { data: { draft, revision: 0 } },
    {
      data: {
        basePublishedRevision: null,
        draft,
        isDirty: "yes",
        revision: 1,
        updatedAt: "2026-10-23T15:30:00.000Z"
      }
    }
  ])("rejects malformed server data", (input) => {
    expect(() => parseCatalogDraftResponse(input)).toThrow(
      "Respuesta de carta inválida."
    );
  });
});
