import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../panel/tenant-fetch";

// The body is a token and a reason: anything bigger is not a waiter call.
const maximumBodyBytes = 1_024;

/**
 * Same-origin proxy for the diner's call to the waiter. The browser never sees
 * the API origin; the tenant is the Host of the request, never the body.
 */
export async function POST(request: Request): Promise<Response> {
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
        {
          error: { code: "WAITER_CALL_TOO_LARGE", message: "Pedido inválido." }
        },
        { status: 413 }
      );
    }
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/waiter-calls`,
      {
        body,
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
      {
        error: { code: "WAITER_CALL_UNREACHABLE", message: "No disponible." }
      },
      { status: 502 }
    );
  }
}
