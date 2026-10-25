import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../panel/tenant-fetch";

const maximumBodyBytes = 65_536;

export async function proxyOnlinePayment(
  request: Request,
  suffix = ""
): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  if (!host) {
    return Response.json(
      { error: { code: "TENANT_NOT_FOUND", message: "Local no disponible." } },
      { status: 404 }
    );
  }
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > maximumBodyBytes) {
      return Response.json(
        { error: { code: "PAYMENT_TOO_LARGE", message: "Pago inválido." } },
        { status: 413 }
      );
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) {
      return Response.json(
        { error: { code: "PAYMENT_TOO_LARGE", message: "Pago inválido." } },
        { status: 413 }
      );
    }
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/online-payments${suffix}`,
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
      { error: { code: "PAYMENT_UNREACHABLE", message: "No disponible." } },
      { status: 502 }
    );
  }
}
