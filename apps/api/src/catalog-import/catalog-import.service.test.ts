import type { CatalogImportDraft } from "@platform/contracts";
import type {
  CatalogImportRepository,
  CatalogRepository
} from "@platform/database";
import { describe, expect, it, vi } from "vitest";

import { CatalogImportService } from "./catalog-import.service.js";

const context = {
  domain: {
    hostname: "tenant.test",
    id: "98000000-0000-4000-8000-000000000098"
  },
  identity: {
    assuranceLevel: "aal2" as const,
    userId: "e1000000-0000-4000-8000-000000000001"
  },
  location: {
    id: "d5322dbe-1883-4a09-a29a-5f108ba4999b",
    name: "Principal"
  },
  role: "admin" as const,
  scope: {
    locationId: "d5322dbe-1883-4a09-a29a-5f108ba4999b",
    tenantId: "6b9532a7-fcda-4e0d-8df7-55298f711902"
  },
  tenant: {
    id: "6b9532a7-fcda-4e0d-8df7-55298f711902",
    name: "Tenant",
    slug: "tenant"
  }
};
const importId = "63a64f34-4df0-4c2f-82ea-5ea308fe2cab";
const reviewed: CatalogImportDraft = {
  errors: [],
  items: [
    {
      category: { confidence: 1, doubtful: false, value: "Cafetería" },
      description: { confidence: 1, doubtful: false, value: "Doble" },
      id: "83ec71fc-e2df-45bd-9fb4-68f58842467b",
      issues: [],
      name: { confidence: 1, doubtful: false, value: "Café" },
      priceCents: { confidence: 1, doubtful: false, value: 150000 },
      rowNumber: 1,
      sector: { confidence: 1, doubtful: false, value: "Barra" }
    }
  ],
  overallConfidence: 1
};

function dependencies() {
  const imports = {
    ackJob: vi.fn(),
    claim: vi.fn(),
    complete: vi.fn(),
    discard: vi.fn(),
    enqueue: vi.fn(),
    fail: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    markApproved: vi.fn().mockResolvedValue({ status: "approved" }),
    readJob: vi.fn()
  } satisfies CatalogImportRepository;
  const catalog = {
    getCurrent: vi.fn(),
    getDraft: vi.fn().mockResolvedValue(null),
    publish: vi.fn(),
    saveDraft: vi.fn().mockResolvedValue({ revision: 1 }),
    setAvailability: vi.fn()
  } satisfies CatalogRepository;
  return { catalog, imports };
}

describe("CatalogImportService", () => {
  it("incorporates corrected rows into the private catalog draft only", async () => {
    const { catalog, imports } = dependencies();
    const service = new CatalogImportService(imports, catalog);

    await service.approve(context, importId, reviewed);

    expect(catalog.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          categories: [expect.objectContaining({ position: 0 })],
          products: [
            expect.objectContaining({
              id: reviewed.items[0]!.id,
              priceCents: 150000
            })
          ],
          sectors: [expect.objectContaining({ kind: "bar" })]
        })
      })
    );
    expect(catalog.publish).not.toHaveBeenCalled();
    expect(imports.markApproved).toHaveBeenCalledAfter(catalog.saveDraft);
  });

  it("does not approve when saving the catalog draft fails", async () => {
    const { catalog, imports } = dependencies();
    vi.mocked(catalog.saveDraft).mockRejectedValueOnce(new Error("conflict"));
    const service = new CatalogImportService(imports, catalog);

    await expect(service.approve(context, importId, reviewed)).rejects.toThrow(
      "conflict"
    );
    expect(imports.markApproved).not.toHaveBeenCalled();
  });
});
