import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../../panel/tenant-fetch";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("host");
  if (!host) return new Response(null, { status: 404 });
  try {
    const { apiUrl } = readWebConfig(process.env);
    const upstream = await tenantFetch(apiUrl + "/v1/public/brand/cover", {
      cache: "no-store",
      headers: { host }
    });
    const contentType = upstream.headers.get("content-type")?.split(";")[0];
    if (
      !upstream.ok ||
      !contentType ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType)
    ) {
      return new Response(null, { status: 404 });
    }
    return new Response(upstream.body, {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": contentType,
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
