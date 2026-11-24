/**
 * What the installed app (PWA) and its notifications show of a restaurant: its name,
 * its colors and its logo, taken from the business profile the Encargado already
 * maintains. Public by nature (it is what the restaurant's own page shows), so it
 * carries nothing personal and nothing of another restaurant.
 */
export type PublicBrandLogo = {
  contentType: string;
  /** Where the private storage keeps it; only the server reads this. */
  objectPath: string;
  /** Changes whenever the logo does, so caches can be told apart. */
  version: string;
};

export type PublicBrand = {
  appearance?: PublicBrandAppearance;
  cover?: PublicBrandLogo;
  backgroundColor: string;
  logo: PublicBrandLogo | null;
  name: string;
  primaryColor: string;
};

/** The public face of a brand: never the storage path of the logo. */
export type PublicBrandView = {
  appearance?: PublicBrandAppearance;
  coverVersion?: string;
  backgroundColor: string;
  logoVersion: string | null;
  name: string;
  primaryColor: string;
};

export const brandIconSizes = [180, 192, 512] as const;
export type BrandIconSize = (typeof brandIconSizes)[number];

const colorPattern = /^#[0-9A-Fa-f]{6}$/u;
const objectPathPattern =
  /^tenants\/[0-9a-f-]{36}\/locations\/[0-9a-f-]{36}\/business-profile\/logo\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type PublicBrandAppearance = {
  accentColor: string;
  description: string;
  headingStyle: "sans" | "serif";
  layout: "compact" | "modern" | "visual";
};

function parseAppearance(value: unknown): PublicBrandAppearance | null {
  const item = record(value);
  if (
    !item ||
    typeof item.accentColor !== "string" ||
    !colorPattern.test(item.accentColor) ||
    typeof item.description !== "string" ||
    item.description.length > 1000 ||
    (item.headingStyle !== "sans" && item.headingStyle !== "serif") ||
    (item.layout !== "compact" &&
      item.layout !== "modern" &&
      item.layout !== "visual")
  )
    return null;
  return {
    accentColor: item.accentColor,
    description: item.description,
    headingStyle: item.headingStyle,
    layout: item.layout
  };
}

function parseCover(value: unknown): PublicBrandLogo | null {
  const cover = record(value);
  if (
    !cover ||
    typeof cover.objectPath !== "string" ||
    !/^tenants\/[0-9a-f-]{36}\/locations\/[0-9a-f-]{36}\/business-profile\/cover\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/u.test(
      cover.objectPath
    ) ||
    typeof cover.contentType !== "string" ||
    !["image/jpeg", "image/png", "image/webp"].includes(cover.contentType) ||
    typeof cover.version !== "string" ||
    !/^[0-9a-f]{16}$/u.test(cover.version)
  )
    return null;
  return {
    objectPath: cover.objectPath,
    contentType: cover.contentType,
    version: cover.version
  };
}
export function parsePublicBrand(input: unknown): PublicBrand | null {
  const root = record(input);
  if (
    !root ||
    typeof root.name !== "string" ||
    root.name.length < 1 ||
    root.name.length > 120 ||
    typeof root.primaryColor !== "string" ||
    !colorPattern.test(root.primaryColor) ||
    typeof root.backgroundColor !== "string" ||
    !colorPattern.test(root.backgroundColor)
  ) {
    return null;
  }
  let logo: PublicBrandLogo | null = null;
  if (root.logo !== null) {
    const candidate = record(root.logo);
    if (
      !candidate ||
      typeof candidate.objectPath !== "string" ||
      !objectPathPattern.test(candidate.objectPath) ||
      typeof candidate.contentType !== "string" ||
      typeof candidate.version !== "string" ||
      !/^[0-9a-f]{16}$/u.test(candidate.version)
    ) {
      return null;
    }
    logo = {
      contentType: candidate.contentType,
      objectPath: candidate.objectPath,
      version: candidate.version
    };
  }
  const appearance = parseAppearance(root.appearance);
  const cover = parseCover(root.cover);
  return {
    ...(appearance ? { appearance } : {}),
    ...(cover ? { cover } : {}),
    backgroundColor: root.backgroundColor,
    logo,
    name: root.name,
    primaryColor: root.primaryColor
  };
}

export function toPublicBrandView(brand: PublicBrand): PublicBrandView {
  return {
    ...(brand.appearance ? { appearance: brand.appearance } : {}),
    ...(brand.cover ? { coverVersion: brand.cover.version } : {}),
    backgroundColor: brand.backgroundColor,
    logoVersion: brand.logo?.version ?? null,
    name: brand.name,
    primaryColor: brand.primaryColor
  };
}

export function parsePublicBrandView(input: unknown): PublicBrandView | null {
  const root = record(input);
  if (
    !root ||
    typeof root.name !== "string" ||
    root.name.length < 1 ||
    typeof root.primaryColor !== "string" ||
    !colorPattern.test(root.primaryColor) ||
    typeof root.backgroundColor !== "string" ||
    !colorPattern.test(root.backgroundColor) ||
    (root.logoVersion !== null &&
      (typeof root.logoVersion !== "string" ||
        !/^[0-9a-f]{16}$/u.test(root.logoVersion)))
  ) {
    return null;
  }
  const appearance = parseAppearance(root.appearance);
  const coverVersion =
    typeof root.coverVersion === "string" &&
    /^[0-9a-f]{16}$/u.test(root.coverVersion)
      ? root.coverVersion
      : null;
  return {
    ...(appearance ? { appearance } : {}),
    ...(coverVersion ? { coverVersion } : {}),
    backgroundColor: root.backgroundColor,
    logoVersion: root.logoVersion as string | null,
    name: root.name,
    primaryColor: root.primaryColor
  };
}

export function parseBrandIconSize(value: unknown): BrandIconSize | null {
  const size = typeof value === "string" ? Number(value) : value;
  return brandIconSizes.find((candidate) => candidate === size) ?? null;
}
