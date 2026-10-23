import { describe, expect, it } from "vitest";

import { createBusinessProfileRepository } from "./business-profile-repository.js";

const unreachableClient = (() => {
  throw new Error("The database must not be queried");
}) as never;

const draft = {
  address: "",
  contactPhone: "",
  coverAssetId: null,
  description: "",
  displayName: "Bodegón Demo",
  languages: ["es"],
  logoAssetId: null,
  openingHours: "",
  referenceAssetIds: [],
  visual: {
    accentColor: "#D97706",
    headingStyle: "serif" as const,
    layout: "visual" as const,
    primaryColor: "#1F2937",
    secondaryColor: "#F9FAFB"
  }
};

describe("business profile repository", () => {
  it("rejects an invalid tenant scope before querying", async () => {
    const repository = createBusinessProfileRepository(unreachableClient);

    await expect(
      repository.saveDraft({
        draft,
        requesterId: "d1000000-0000-4000-8000-000000000001",
        scope: {
          locationId: "d5000000-0000-4000-8000-000000000005",
          tenantId: "from-client"
        }
      })
    ).rejects.toThrow("tenant scope must be canonical");
  });

  it("rejects a malformed draft before querying", async () => {
    const repository = createBusinessProfileRepository(unreachableClient);

    await expect(
      repository.saveDraft({
        draft: { ...draft, displayName: " " },
        requesterId: "d1000000-0000-4000-8000-000000000001",
        scope: {
          locationId: "d5000000-0000-4000-8000-000000000005",
          tenantId: "d3000000-0000-4000-8000-000000000003"
        }
      })
    ).rejects.toThrow("business profile draft must be canonical");
  });

  it("rejects an invalid requester before querying", async () => {
    const repository = createBusinessProfileRepository(unreachableClient);

    await expect(
      repository.getDraft(
        {
          locationId: "d5000000-0000-4000-8000-000000000005",
          tenantId: "d3000000-0000-4000-8000-000000000003"
        },
        "requester-from-client"
      )
    ).rejects.toThrow("requesterId must be a UUID");
  });
});
