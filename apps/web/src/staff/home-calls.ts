import { parseWaiterSalonView } from "@platform/contracts";

import { openCallIds } from "./call-alerts";
import { callStaffApi } from "./waiter-api";

/**
 * Calls nobody took yet, read for the staff home. A failure is "unknown" (null), never zero:
 * the home must not tell a waiter that nobody is calling when the answer is just missing.
 */
export async function countUnattendedCalls(
  tenantSlug: string
): Promise<number | null> {
  try {
    const response = await callStaffApi(tenantSlug, "GET", "/v1/staff/salon");
    if ("sessionMissing" in response || !response.ok) return null;
    const view = parseWaiterSalonView(
      (response.body as { data?: unknown } | null)?.data
    );
    return view ? openCallIds(view.calls).length : null;
  } catch {
    return null;
  }
}
