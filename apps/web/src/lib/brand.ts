import type { MetadataRoute } from "next";

import { readWebConfig } from "@platform/config";
import {
  parsePublicBrandView,
  type PublicBrandView
} from "@platform/contracts";

import { tenantFetch } from "../app/panel/tenant-fetch";

/**
 * The name, colors and logo version of the restaurant of this host, or null if the API
 * does not answer. Callers must work without it: nothing may wait on the brand.
 */
export async function loadBrand(host: string): Promise<PublicBrandView | null> {
  if (!host) return null;
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(`${config.apiUrl}/v1/public/brand`, {
      cache: "no-store",
      headers: { host }
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: unknown };
    return parsePublicBrandView(body.data);
  } catch {
    return null;
  }
}

/** The address of an icon; the version changes with the logo, so caches follow it. */
export function brandIconUrl(
  size: 180 | 192 | 512,
  options: { maskable?: boolean; version?: string | null } = {}
): string {
  const query = new URLSearchParams({ size: String(size) });
  if (options.maskable) query.set("maskable", "1");
  if (options.version) query.set("v", options.version);
  return `/api/brand/icon?${query.toString()}`;
}

/**
 * The manifest of the installed app: the restaurant's name and colors, and its logo as
 * the icon. Without the brand it is still a valid manifest, with a neutral name.
 */
export function manifestFor(
  brand: PublicBrandView | null
): MetadataRoute.Manifest {
  const version = brand?.logoVersion ?? null;
  const name = brand?.name ?? "Mozo";
  return {
    background_color: brand?.backgroundColor ?? "#ffffff",
    display: "standalone",
    icons: [
      {
        purpose: "any",
        sizes: "192x192",
        src: brandIconUrl(192, { version }),
        type: "image/png"
      },
      {
        purpose: "any",
        sizes: "512x512",
        src: brandIconUrl(512, { version }),
        type: "image/png"
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: brandIconUrl(512, { maskable: true, version }),
        type: "image/png"
      }
    ],
    lang: "es",
    name,
    short_name: Array.from(name).slice(0, 12).join(""),
    start_url: "/cuenta",
    theme_color: brand?.primaryColor ?? "#ffffff"
  };
}
