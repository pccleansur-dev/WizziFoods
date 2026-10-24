import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../panel/tenant-fetch";

export async function POST(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  if (!host) {
    return Response.json(
      { error: { code: "TENANT_NOT_FOUND", message: "Local no disponible." } },
      { status: 404 }
    );
  }
  try {
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/drafts/recalculate`,
      {
        body: await request.text(),
        cache: "no-store",
        headers: { "content-type": "application/json", host },
        method: "POST"
      }
    );
    return new Response(await upstream.text(), {
      headers: { "content-type": "application/json" },
      status: upstream.status
    });
  } catch {
    return Response.json(
      { error: { code: "DINER_DRAFT_UNREACHABLE", message: "No disponible." } },
      { status: 502 }
    );
  }
}
