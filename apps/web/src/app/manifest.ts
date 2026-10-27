import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { loadBrand, manifestFor } from "../lib/brand";

export const dynamic = "force-dynamic";

/**
 * The manifest of the installed app, per restaurant: it takes the name, the colors and
 * the logo from the business profile of the host. It is fetched by the browser on its
 * own, never by a page, so the menu and the login do not wait for it.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host") ?? "";
  return manifestFor(await loadBrand(host));
}
