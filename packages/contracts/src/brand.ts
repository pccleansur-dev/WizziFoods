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
  backgroundColor: string;
  logo: PublicBrandLogo | null;
  name: string;
  primaryColor: string;
};

/** The public face of a brand: never the storage path of the logo. */
export type PublicBrandView = {
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
  return {
    backgroundColor: root.backgroundColor,
    logo,
    name: root.name,
    primaryColor: root.primaryColor
  };
}

export function toPublicBrandView(brand: PublicBrand): PublicBrandView {
  return {
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
  return {
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
