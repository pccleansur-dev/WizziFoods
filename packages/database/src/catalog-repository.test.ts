import { describe, expect, it } from "vitest";

import { createCatalogRepository } from "./catalog-repository.js";

const scope = {
  locationId: "f8000000-0000-4000-8000-000000000008",
  tenantId: "f3000000-0000-4000-8000-000000000003"
};
const requesterId = "f1000000-0000-4000-8000-000000000001";
const productId = "f7000000-0000-4000-8000-000000000007";
const draft = {
  baseRevision: null,
  categories: [
    {
      content: [{ description: "", language: "es", title: "Principales" }],
      id: "f5000000-0000-4000-8000-000000000005",
      position: 0
    }
  ],
  products: [
    {
      categoryId: "f5000000-0000-4000-8000-000000000005",
      content: [
        {
          description: "Con papas",
          language: "es",
          title: "Milanesa"
        }
      ],
      id: productId,
      imageAssetId: null,
      position: 0,
      priceCents: 125000,
      sectorId: "f6000000-0000-4000-8000-000000000006",
      variants: []
    }
  ],
  sectors: [
    {
      id: "f6000000-0000-4000-8000-000000000006",
      kind: "kitchen" as const,
      name: "Cocina",
      position: 0
    }
  ]
};

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

describe("catalog repository", () => {
  it("maps a resumed catalog draft", async () => {
    const client = (() =>
      Promise.resolve([
        {
          base_published_revision: null,
          is_dirty: true,
          revision: 1,
          snapshot: draft,
          updated_at: "2026-10-23 15:00:00+00"
        }
      ])) as never;
    const repository = createCatalogRepository(client);

    await expect(repository.getDraft(scope, requesterId)).resolves.toEqual({
      basePublishedRevision: null,
      draft,
      isDirty: true,
      revision: 1,
      updatedAt: "2026-10-23T15:00:00.000Z"
    });
  });

  it("maps the public catalog and its independent availability", async () => {
    const client = (() =>
      Promise.resolve([
        {
          availability: {
            [productId]: { isAvailable: false, version: 2 }
          },
          published_at: new Date("2026-10-23T15:05:00.000Z"),
          revision: 3,
          snapshot: { ...draft, baseRevision: 2 }
        }
      ])) as never;
    const repository = createCatalogRepository(client);

    await expect(repository.getCurrent(scope)).resolves.toMatchObject({
      availability: {
        [productId]: { isAvailable: false, version: 2 }
      },
      publishedAt: "2026-10-23T15:05:00.000Z",
      revision: 3
    });
  });

  it("rejects availability hidden inside a draft before querying", async () => {
    const repository = createCatalogRepository(unreachableClient);

    await expect(
      repository.saveDraft({
        draft: { ...draft, isAvailable: true } as never,
        requesterId,
        scope
      })
    ).rejects.toThrow("catalog draft must be canonical");
  });

  it("rejects an invalid optimistic availability version before querying", async () => {
    const repository = createCatalogRepository(unreachableClient);

    await expect(
      repository.setAvailability({
        expectedVersion: 0,
        isAvailable: false,
        productId,
        requesterId,
        scope
      })
    ).rejects.toThrow("expectedVersion must be null or a positive integer");
  });

  it("rejects a non-boolean availability value before querying", async () => {
    const repository = createCatalogRepository(unreachableClient);

    await expect(
      repository.setAvailability({
        expectedVersion: null,
        isAvailable: "false" as never,
        productId,
        requesterId,
        scope
      })
    ).rejects.toThrow("isAvailable must be a boolean");
  });

  it("rejects a malformed tenant scope before querying", async () => {
    const repository = createCatalogRepository(unreachableClient);

    await expect(
      repository.publish({
        expectedDraftRevision: 1,
        requesterId,
        scope: { ...scope, tenantId: "from-client" }
      })
    ).rejects.toThrow("tenant scope must be canonical");
  });
});
