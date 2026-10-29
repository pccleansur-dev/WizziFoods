import { readWebConfig } from "@platform/config";
import { parseCatalogImageAssetId } from "@platform/contracts";

import { tenantFetch } from "../../../../panel/tenant-fetch";

export const dynamic = "force-dynamic";

const empty = (status: number) => new Response(null, { status });
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The photo of a product of the menu of this host. It forwards the host so the API picks the
 * restaurant; the address names only the photo. Any failure is a plain 404: a photo is never
 * worth a menu breaking.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> }
): Promise<Response> {
  const assetId = parseCatalogImageAssetId((await context.params).assetId);
  const host = request.headers.get("host") ?? "";
  if (!assetId || !host) return empty(404);
  try {
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/catalog/images/${assetId}`,
      { cache: "no-store", headers: { host } }
    );
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !imageTypes.has(contentType)) return empty(404);
    return new Response(await upstream.arrayBuffer(), {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": contentType,
        "x-content-type-options": "nosniff"
      },
      status: 200
    });
  } catch {
    return empty(404);
  }
}
