import { readWebConfig } from "@platform/config";
import { parseBrandIconSize } from "@platform/contracts";

import { tenantFetch } from "../../../panel/tenant-fetch";

export const dynamic = "force-dynamic";

const empty = (status: number) => new Response(null, { status });

/**
 * The icon of the restaurant of this host, for the installed app, the home screen and
 * the notifications. It forwards the host so the API picks the restaurant; nothing in the
 * request can name another one. Any failure is a plain 404: an icon is never worth a page
 * breaking.
 */
export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  const url = new URL(request.url);
  const size = parseBrandIconSize(url.searchParams.get("size"));
  const maskable = url.searchParams.get("maskable");
  if (!host || !size || (maskable !== null && maskable !== "1")) {
    return empty(400);
  }
  try {
    const config = readWebConfig(process.env);
    const query = new URLSearchParams({ size: String(size) });
    if (maskable === "1") query.set("maskable", "1");
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/brand/icon?${query.toString()}`,
      { cache: "no-store", headers: { host } }
    );
    if (!upstream.ok) return empty(404);
    return new Response(await upstream.arrayBuffer(), {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": "image/png"
      },
      status: 200
    });
  } catch {
    return empty(404);
  }
}
