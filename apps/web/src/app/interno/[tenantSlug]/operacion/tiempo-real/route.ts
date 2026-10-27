import { readWebAuthConfig } from "@platform/config";
import { parseRealtimeGrant } from "@platform/contracts";

import { callStaffApi } from "../../../../../staff/waiter-api";

const noStore = { "cache-control": "no-store" } as const;

/**
 * Hands the browser a short-lived token to listen to the "something changed" channels of
 * its own restaurant. The staff session never leaves the server: this route exchanges it
 * with the API, which decides the channels from the role. Without Realtime configured it
 * answers 503 and the screens keep polling.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  const { tenantSlug } = await params;
  let response: Awaited<ReturnType<typeof callStaffApi>>;
  try {
    response = await callStaffApi(
      tenantSlug,
      "POST",
      "/v1/staff/realtime/token"
    );
  } catch {
    return Response.json(null, { headers: noStore, status: 503 });
  }
  if ("sessionMissing" in response || response.status === 401) {
    return Response.json(null, { headers: noStore, status: 401 });
  }
  if (!response.ok) {
    return Response.json(null, { headers: noStore, status: response.status });
  }
  const grant = parseRealtimeGrant(
    (response.body as { data?: unknown } | null)?.data
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
}
