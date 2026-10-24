"use server";

import {
  isWaiterUuid,
  parseProductionAdvanceRequest,
  parseProductionAdvanceResult,
  type ProductionAdvanceRequest,
  type ProductionAdvanceResult
} from "@platform/contracts";

import { callStaffApi } from "../../../../staff/waiter-api";
import {
  waiterErrorCode,
  waiterErrorMessage
} from "../../../../staff/waiter-view";
import type { WaiterActionResult } from "./waiter-action-result";

function failure(code: string | null): WaiterActionResult<never> {
  return { code, message: waiterErrorMessage(code), status: "error" };
}

/** Moves one item of the viewer's own sector one step forward. */
export async function advanceProductionItemAction(
  tenantSlug: string,
  orderId: string,
  lineId: string,
  request: ProductionAdvanceRequest
): Promise<WaiterActionResult<ProductionAdvanceResult>> {
  const parsed = parseProductionAdvanceRequest(request);
  if (!isWaiterUuid(orderId) || !isWaiterUuid(lineId) || !parsed) {
    return failure("INVALID_WAITER_REQUEST");
  }
  let response: Awaited<ReturnType<typeof callStaffApi>>;
  try {
    response = await callStaffApi(
      tenantSlug,
      "POST",
      `/v1/staff/production/orders/${orderId}/items/${lineId}/status`,
      parsed
    );
  } catch {
    return failure(null);
  }
  if ("sessionMissing" in response || response.status === 401) {
    return failure("STAFF_SESSION_INVALID");
  }
  if (!response.ok) return failure(waiterErrorCode(response.body));
  const data = parseProductionAdvanceResult(
    (response.body as { data?: unknown } | null)?.data
  );
  return data === null ? failure(null) : { data, status: "ok" };
}
