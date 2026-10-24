import type { SavedBusinessProfileDraft } from "../business-profile";

/** Perfil a editar: el guardado o, si todavía no hay, uno inicial con el nombre del negocio. */
export function editableBusinessProfile(
  saved: SavedBusinessProfileDraft | null,
  tenantName: string
) {
  return (
    saved ?? {
      address: "",
      contactPhone: "",
      coverAssetId: null,
      description: "",
      displayName: tenantName,
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
    }
  );
}
