import { readWebAuthConfig, readWebConfig } from "@platform/config";
import { parseRealtimeGrant } from "@platform/contracts";

import { tenantFetch } from "../../panel/tenant-fetch";

const noStore = { "cache-control": "no-store" } as const;
const maximumBodyBytes = 512;

/**
 * Hands a diner's page a short-lived token to hear "something changed" about the table
 * its QR stands for. The API checks the QR against the business named by the host and
 * decides the channel; without Realtime configured it answers 503 and the page keeps
 * asking by itself, as before.
 */
export async function POST(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  if (!host) return Response.json(null, { headers: noStore, status: 404 });
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) {
      return Response.json(null, { headers: noStore, status: 413 });
    }
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/realtime/token`,
      {
        body,
        cache: "no-store",
        headers: { "content-type": "application/json", host },
        method: "POST"
      }
    );
    if (!upstream.ok) {
      return Response.json(null, { headers: noStore, status: upstream.status });
    }
    const grant = parseRealtimeGrant(
      ((await upstream.json().catch(() => null)) as { data?: unknown } | null)
        ?.data
    );
    if (!grant) return Response.json(null, { headers: noStore, status: 502 });
    const auth = readWebAuthConfig(process.env);
    return Response.json(
      {
        ...grant,
        publishableKey: auth.supabasePublishableKey,
        url: auth.supabaseUrl
      },
      { headers: noStore }
    );
  } catch {
    return Response.json(null, { headers: noStore, status: 503 });
  }
}
