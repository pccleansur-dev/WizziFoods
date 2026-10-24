import { parseWaiterOrdersView } from "@platform/contracts";

import { callStaffApi } from "../../../../../../staff/waiter-api";

const noStore = { "cache-control": "no-store" } as const;

/**
 * Same-origin polling endpoint for the orders in progress of a waiter. The
 * httpOnly cookie is scoped to `/interno/<tenant>`, so only this path can carry
 * the session to the API, which decides the tables from the session alone.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  const { tenantSlug } = await params;
  let response: Awaited<ReturnType<typeof callStaffApi>>;
  try {
    response = await callStaffApi(
      tenantSlug,
      "GET",
      "/v1/staff/orders/in-progress"
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
  const view = parseWaiterOrdersView(
    (response.body as { data?: unknown } | null)?.data
  );
  return view
    ? Response.json(view, { headers: noStore })
    : Response.json(null, { headers: noStore, status: 502 });
}
