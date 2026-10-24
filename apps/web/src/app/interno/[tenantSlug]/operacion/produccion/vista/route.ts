import { parseProductionBoard } from "@platform/contracts";

import { callStaffApi } from "../../../../../../staff/waiter-api";

const noStore = { "cache-control": "no-store" } as const;

/**
 * Same-origin polling endpoint for the Kitchen and Bar screens. The httpOnly
 * cookie is scoped to `/interno/<tenant>`, so only this path can carry the
 * session to the API, which decides the sector from the session alone.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  const { tenantSlug } = await params;
  let response: Awaited<ReturnType<typeof callStaffApi>>;
  try {
    response = await callStaffApi(tenantSlug, "GET", "/v1/staff/production");
  } catch {
    return Response.json(null, { headers: noStore, status: 503 });
  }
  if ("sessionMissing" in response || response.status === 401) {
    return Response.json(null, { headers: noStore, status: 401 });
  }
  if (!response.ok) {
    return Response.json(null, { headers: noStore, status: response.status });
  }
  const board = parseProductionBoard(
    (response.body as { data?: unknown } | null)?.data
  );
  return board
    ? Response.json(board, { headers: noStore })
    : Response.json(null, { headers: noStore, status: 502 });
}
