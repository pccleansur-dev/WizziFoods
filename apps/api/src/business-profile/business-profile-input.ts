import {
  parseBusinessProfileDraft,
  type BusinessProfileDraft
} from "@platform/contracts";

function normalizedText(value: unknown): unknown {
  return typeof value === "string" ? value.trim().normalize("NFKC") : value;
}

export function parseBusinessProfileRequest(
  input: unknown
): BusinessProfileDraft {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Datos del perfil del negocio inválidos.");
  }
  const value = input as Record<string, unknown>;
  const visualRecord =
    value.visual &&
    typeof value.visual === "object" &&
    !Array.isArray(value.visual)
      ? (value.visual as Record<string, unknown>)
      : null;
  const normalized = {
    ...value,
    address: normalizedText(value.address),
    contactPhone: normalizedText(value.contactPhone),
    coverAssetId:
      typeof value.coverAssetId === "string"
        ? value.coverAssetId.toLowerCase()
        : value.coverAssetId,
    description: normalizedText(value.description),
    displayName: normalizedText(value.displayName),
    languages: Array.isArray(value.languages)
      ? value.languages.map(normalizedText)
      : value.languages,
    logoAssetId:
      typeof value.logoAssetId === "string"
        ? value.logoAssetId.toLowerCase()
        : value.logoAssetId,
    openingHours: normalizedText(value.openingHours),
    referenceAssetIds: Array.isArray(value.referenceAssetIds)
      ? value.referenceAssetIds.map((assetId) =>
          typeof assetId === "string" ? assetId.toLowerCase() : assetId
        )
      : value.referenceAssetIds,
    visual: visualRecord
      ? {
          ...visualRecord,
          accentColor:
            typeof visualRecord.accentColor === "string"
              ? visualRecord.accentColor.toUpperCase()
              : visualRecord.accentColor,
          primaryColor:
            typeof visualRecord.primaryColor === "string"
              ? visualRecord.primaryColor.toUpperCase()
              : visualRecord.primaryColor,
          secondaryColor:
            typeof visualRecord.secondaryColor === "string"
              ? visualRecord.secondaryColor.toUpperCase()
              : visualRecord.secondaryColor
        }
      : value.visual
  };
  const parsed = parseBusinessProfileDraft(normalized);
  if (!parsed) throw new Error("Datos del perfil del negocio inválidos.");
  return parsed;
}
