import type {
  BusinessProfileDraftRecord,
  BusinessProfileRepository
} from "@platform/database";
import type { BusinessProfileDraft } from "@platform/contracts";
import { describe, expect, it } from "vitest";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";
import { BusinessProfileService } from "./business-profile.service.js";

const context = {
  identity: {
    assuranceLevel: "aal2",
    userId: "d1000000-0000-4000-8000-000000000001"
  },
  scope: {
    locationId: "d5000000-0000-4000-8000-000000000005",
    tenantId: "d3000000-0000-4000-8000-000000000003"
  }
} as TenantAdminRequestContext;

const draft: BusinessProfileDraftRecord = {
  address: "",
  contactPhone: "",
  coverAssetId: null,
  description: "",
  displayName: "Bodegón Demo",
  languages: ["es"],
  logoAssetId: null,
  openingHours: "",
  referenceAssetIds: [],
  revision: 1,
  updatedAt: "2026-10-22T21:00:00.000Z",
  visual: {
    accentColor: "#D97706",
    headingStyle: "serif",
    layout: "visual",
    primaryColor: "#1F2937",
    secondaryColor: "#F9FAFB"
  }
};

describe("BusinessProfileService", () => {
  it("reads and saves only through the guarded tenant context", async () => {
    const editableDraft: BusinessProfileDraft = {
      address: draft.address,
      contactPhone: draft.contactPhone,
      coverAssetId: draft.coverAssetId,
      description: draft.description,
      displayName: draft.displayName,
      languages: draft.languages,
      logoAssetId: draft.logoAssetId,
      openingHours: draft.openingHours,
      referenceAssetIds: draft.referenceAssetIds,
      visual: draft.visual
    };
    const received: unknown[] = [];
    const repository = {
      getDraft: async (...input) => {
        received.push(["get", ...input]);
        return draft;
      },
      saveDraft: async (input) => {
        received.push(["save", input]);
        return { ...draft, revision: 2 };
      }
    } as BusinessProfileRepository;
    const service = new BusinessProfileService(repository);

    await expect(service.getDraft(context)).resolves.toEqual(draft);
    await expect(
      service.saveDraft(context, editableDraft)
    ).resolves.toMatchObject({
      revision: 2
    });
    expect(received).toEqual([
      ["get", context.scope, context.identity.userId],
      [
        "save",
        {
          draft: editableDraft,
          requesterId: context.identity.userId,
          scope: context.scope
        }
      ]
    ]);
  });
});
