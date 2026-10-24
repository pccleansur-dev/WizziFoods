import { describe, expect, it } from "vitest";

import { parsePublicCatalogResponse } from "./public-catalog";

const productId = "a1000000-0000-4000-8000-000000000001";

const response = {
  data: {
    availability: {
      [productId]: { isAvailable: false, version: 2 }
    },
    catalog: {
      baseRevision: null,
      categories: [],
      products: [],
      sectors: []
    },
    publishedAt: "2026-10-24T00:00:00.000Z",
    revision: 3
  }
};

describe("parsePublicCatalogResponse", () => {
  it("accepts the current publication with immediate availability", () => {
    expect(parsePublicCatalogResponse(response)).toEqual(response.data);
  });

  it.each([
    null,
    { data: null },
    { data: { ...response.data, revision: 0 } },
    {
      data: {
        ...response.data,
        availability: { [productId]: { isAvailable: "false", version: 2 } }
      }
    }
  ])("rejects a malformed public response", (input) => {
    expect(parsePublicCatalogResponse(input)).toBeNull();
  });
});
