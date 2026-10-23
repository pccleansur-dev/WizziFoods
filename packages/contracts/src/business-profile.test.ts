import { describe, expect, it } from "vitest";

import { parseBusinessProfileDraft } from "./business-profile.js";

const validDraft = {
  address: "Av. Siempre Viva 742",
  contactPhone: "+54 9 11 5555 1234",
  coverAssetId: "12000000-0000-4000-8000-000000000012",
  description: "Cocina argentina de estación.",
  displayName: "Bodegón Demo",
  languages: ["es", "en"],
  logoAssetId: "11000000-0000-4000-8000-000000000011",
  openingHours: "Martes a domingo de 12:00 a 00:00",
  referenceAssetIds: ["13000000-0000-4000-8000-000000000013"],
  visual: {
    accentColor: "#D97706",
    headingStyle: "serif",
    layout: "visual",
    primaryColor: "#1F2937",
    secondaryColor: "#F9FAFB"
  }
};

describe("business profile draft", () => {
  it("parses an editable identity draft", () => {
    expect(parseBusinessProfileDraft(validDraft)).toEqual(validDraft);
  });

  it("allows incomplete text and media while onboarding is in progress", () => {
    expect(
      parseBusinessProfileDraft({
        ...validDraft,
        address: "",
        contactPhone: "",
        coverAssetId: null,
        description: "",
        logoAssetId: null,
        openingHours: "",
        referenceAssetIds: []
      })
    ).not.toBeNull();
  });

  it.each([
    { ...validDraft, tenantId: "from-client" },
    { ...validDraft, languages: [] },
    { ...validDraft, languages: ["es", "es"] },
    { ...validDraft, logoAssetId: "../other-tenant" },
    {
      ...validDraft,
      referenceAssetIds: Array.from(
        { length: 13 },
        (_, index) =>
          `13000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      )
    },
    { ...validDraft, visual: { ...validDraft.visual, primaryColor: "red" } },
    { ...validDraft, visual: { ...validDraft.visual, layout: "custom-css" } }
  ])("rejects malformed or over-scoped drafts", (input) => {
    expect(parseBusinessProfileDraft(input)).toBeNull();
  });
});
