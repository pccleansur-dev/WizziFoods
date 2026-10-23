import { describe, expect, it } from "vitest";

import {
  parseAvailabilityRequest,
  parseCatalogDraftRequest,
  parsePublishCatalogRequest
} from "./catalog-input.js";

const draft = {
  baseRevision: null,
  categories: [],
  products: [],
  sectors: []
};

describe("catalog HTTP input", () => {
  it("accepts a canonical draft", () => {
    expect(parseCatalogDraftRequest(draft)).toEqual(draft);
  });

  it.each([
    { ...draft, availability: {} },
    { ...draft, tenantId: crypto.randomUUID() },
    { ...draft, baseRevision: 0 }
  ])("rejects over-scoped or malformed drafts", (input) => {
    expect(() => parseCatalogDraftRequest(input)).toThrow(
      "Datos de la carta inválidos."
    );
  });

  it("accepts an optimistic publication request", () => {
    expect(parsePublishCatalogRequest({ expectedDraftRevision: 3 })).toEqual({
      expectedDraftRevision: 3
    });
  });

  it("accepts an initial immediate availability change", () => {
    expect(
      parseAvailabilityRequest({ expectedVersion: null, isAvailable: false })
    ).toEqual({ expectedVersion: null, isAvailable: false });
  });

  it.each([
    {},
    { expectedVersion: 0, isAvailable: false },
    { expectedVersion: null, isAvailable: "false" },
    { expectedVersion: null, isAvailable: false, tenantId: "client" }
  ])("rejects malformed availability changes", (input) => {
    expect(() => parseAvailabilityRequest(input)).toThrow(
      "Cambio de disponibilidad inválido."
    );
  });
});
