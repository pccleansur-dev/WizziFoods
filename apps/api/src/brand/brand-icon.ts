import sharp from "sharp";

export type BrandIconInput = {
  backgroundColor: string;
  /** The logo as uploaded and already normalized by the media worker; null for none. */
  logo: Buffer | null;
  /** Keeps the logo inside the circle that Android may crop the icon to. */
  maskable: boolean;
  name: string;
  primaryColor: string;
  size: number;
};

function initialOf(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name);
  return match ? match[0].toUpperCase() : "M";
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, "");
}

/** A plain square in the brand color with the first letter, for a restaurant with no logo. */
function fallbackSvg(input: BrandIconInput): Buffer {
  const { size } = input;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="${input.primaryColor}"/>` +
      `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" ` +
      `font-weight="700" font-size="${Math.round(size * 0.5)}" fill="${input.backgroundColor}">${escapeXml(initialOf(input.name))}</text>` +
      `</svg>`
  );
}

/**
 * The icon of the installed app and of its notifications: always a square PNG of the
 * asked size. With a logo, it is centered on the restaurant's background color with some
 * breathing room (more when it must survive a circular crop). Without a logo, or if the
 * logo cannot be read, it is a plain tile with the first letter of the name: an icon
 * must never fail to exist.
 */
export async function renderBrandIcon(input: BrandIconInput): Promise<Buffer> {
  const { size } = input;
  if (input.logo) {
    try {
      const inner = Math.round(size * (input.maskable ? 0.56 : 0.8));
      const logo = await sharp(input.logo, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(inner, inner, {
          background: { alpha: 0, b: 0, g: 0, r: 0 },
          fit: "inside",
          withoutEnlargement: false
        })
        .png()
        .toBuffer();
      return await sharp({
        create: {
          background: input.backgroundColor,
          channels: 4,
          height: size,
          width: size
        }
      })
        .composite([{ blend: "over", gravity: "centre", input: logo }])
        .png()
        .toBuffer();
    } catch {
      // Fall through to the plain tile.
    }
  }
  return sharp(fallbackSvg(input)).png().toBuffer();
}
