import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../../panel/tenant-fetch";

export const dynamic = "force-dynamic";

/** Whether this restaurant's menu may offer the optional Google login at all. */
export async function GET(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  const none = Response.json({ data: { available: false } });
  if (!host) return none;
  try {
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/diner-auth/availability`,
      { cache: "no-store", headers: { host }, method: "GET" }
    );
    if (!upstream.ok) return none;
    return new Response(await upstream.text(), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json"
      },
      status: 200
    });
  } catch {
    return none;
  }
}
