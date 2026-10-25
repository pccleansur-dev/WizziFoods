import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../panel/tenant-fetch";

const maximumBodyBytes = 4_096;

/** Forwards a diner's split request to the API with the host that names the business. */
export async function proxySplit(
  request: Request,
  action: "claim" | "release" | "view"
): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  if (!host) {
    return Response.json(
      { error: { code: "TENANT_NOT_FOUND", message: "Local no disponible." } },
      { status: 404 }
    );
  }
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) {
      return Response.json(
        { error: { code: "SPLIT_TOO_LARGE", message: "Pedido inválido." } },
        { status: 413 }
      );
    }
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/account-splits/${action}`,
      {
        body,
        cache: "no-store",
        headers: { "content-type": "application/json", host },
        method: "POST"
      }
    );
    return new Response(await upstream.text(), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json"
      },
      status: upstream.status
    });
  } catch {
    return Response.json(
      { error: { code: "SPLIT_UNREACHABLE", message: "No disponible." } },
      { status: 502 }
    );
  }
}
