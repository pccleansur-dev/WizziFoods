export type BusinessProfileLayout = "compact" | "modern" | "visual";
export type BusinessProfileHeadingStyle = "sans" | "serif";

export type BusinessProfileDraft = {
  address: string;
  contactPhone: string;
  coverAssetId: string | null;
  description: string;
  displayName: string;
  languages: string[];
  logoAssetId: string | null;
  openingHours: string;
  referenceAssetIds: string[];
  visual: {
    accentColor: string;
    headingStyle: BusinessProfileHeadingStyle;
    layout: BusinessProfileLayout;
    primaryColor: string;
    secondaryColor: string;
  };
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const languagePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/u;
const colorPattern = /^#[0-9A-F]{6}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[]
): boolean {
  return Object.keys(value).sort().join("\0") === expected.sort().join("\0");
}

function boundedString(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function nullableUuid(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && uuidPattern.test(value))
  );
}

export function parseBusinessProfileDraft(
  input: unknown
): BusinessProfileDraft | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, [
      "address",
      "contactPhone",
      "coverAssetId",
      "description",
      "displayName",
      "languages",
      "logoAssetId",
      "openingHours",
      "referenceAssetIds",
      "visual"
    ]) ||
    !boundedString(candidate.address, 0, 300) ||
    !boundedString(candidate.contactPhone, 0, 40) ||
    !boundedString(candidate.description, 0, 1_000) ||
    !boundedString(candidate.displayName, 1, 120) ||
    !boundedString(candidate.openingHours, 0, 500) ||
    !nullableUuid(candidate.logoAssetId) ||
    !nullableUuid(candidate.coverAssetId) ||
    !Array.isArray(candidate.languages) ||
    candidate.languages.length < 1 ||
    candidate.languages.length > 5 ||
    candidate.languages.some(
      (language) =>
        typeof language !== "string" || !languagePattern.test(language)
    ) ||
    new Set(candidate.languages).size !== candidate.languages.length ||
    !Array.isArray(candidate.referenceAssetIds) ||
    candidate.referenceAssetIds.length > 12 ||
    candidate.referenceAssetIds.some(
      (assetId) => typeof assetId !== "string" || !uuidPattern.test(assetId)
    ) ||
    new Set(candidate.referenceAssetIds).size !==
      candidate.referenceAssetIds.length
  ) {
    return null;
  }

  const visual = record(candidate.visual);
  if (
    !visual ||
    !hasExactKeys(visual, [
      "accentColor",
      "headingStyle",
      "layout",
      "primaryColor",
      "secondaryColor"
    ]) ||
    typeof visual.accentColor !== "string" ||
    !colorPattern.test(visual.accentColor) ||
    typeof visual.primaryColor !== "string" ||
    !colorPattern.test(visual.primaryColor) ||
    typeof visual.secondaryColor !== "string" ||
    !colorPattern.test(visual.secondaryColor) ||
    (visual.headingStyle !== "sans" && visual.headingStyle !== "serif") ||
    (visual.layout !== "compact" &&
      visual.layout !== "modern" &&
      visual.layout !== "visual")
  ) {
    return null;
  }

  return {
    address: candidate.address as string,
    contactPhone: candidate.contactPhone as string,
    coverAssetId: candidate.coverAssetId as string | null,
    description: candidate.description as string,
    displayName: candidate.displayName as string,
    languages: [...candidate.languages] as string[],
    logoAssetId: candidate.logoAssetId as string | null,
    openingHours: candidate.openingHours as string,
    referenceAssetIds: [...candidate.referenceAssetIds] as string[],
    visual: {
      accentColor: visual.accentColor,
      headingStyle: visual.headingStyle,
      layout: visual.layout,
      primaryColor: visual.primaryColor,
      secondaryColor: visual.secondaryColor
    }
  };
}
