"use server";

import {
  isWaiterUuid,
  parseCancelItemRequest,
  parseCancelItemResult,
  parseDeliverItemRequest,
  parseItemStateResult,
  parseProductionExceptionRequest,
  parseReplacementDecisionRequest,
  parseReplacementDecisionResult,
  parseReplacementProposalRequest,
  parseReplacementProposalResult,
  type CancelItemRequest,
  type CancelItemResult,
  type DeliverItemRequest,
  type ItemStateResult,
  type ProductionExceptionRequest,
  type ReplacementDecisionRequest,
  type ReplacementDecisionResult,
  type ReplacementProposalRequest,
  type ReplacementProposalResult
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

async function run<T>(
  tenantSlug: string,
  path: string,
  payload: unknown,
  parse: (data: unknown) => T | null
): Promise<WaiterActionResult<T>> {
  let response: Awaited<ReturnType<typeof callStaffApi>>;
  try {
    response = await callStaffApi(tenantSlug, "POST", path, payload);
  } catch {
    return failure(null);
  }
  if ("sessionMissing" in response || response.status === 401) {
    return failure("STAFF_SESSION_INVALID");
  }
  if (!response.ok) return failure(waiterErrorCode(response.body));
  const data = parse((response.body as { data?: unknown } | null)?.data);
  return data === null ? failure(null) : { data, status: "ok" };
}

const invalid = () => failure("INVALID_ORDER_ADJUSTMENT_REQUEST");

export async function deliverItemAction(
  tenantSlug: string,
  orderId: string,
  lineId: string,
  request: DeliverItemRequest
): Promise<WaiterActionResult<ItemStateResult>> {
  const parsed = parseDeliverItemRequest(request);
  if (!isWaiterUuid(orderId) || !isWaiterUuid(lineId) || !parsed) {
    return invalid();
  }
  return run(
    tenantSlug,
    `/v1/staff/orders/${orderId}/items/${lineId}/delivery`,
    parsed,
    parseItemStateResult
  );
}

/** Kitchen and Bar: this sector cannot make the item. */
export async function reportProductionExceptionAction(
  tenantSlug: string,
  orderId: string,
  lineId: string,
  request: ProductionExceptionRequest
): Promise<WaiterActionResult<ItemStateResult>> {
  const parsed = parseProductionExceptionRequest(request);
  if (!isWaiterUuid(orderId) || !isWaiterUuid(lineId) || !parsed) {
    return invalid();
  }
  return run(
    tenantSlug,
    `/v1/staff/production/orders/${orderId}/items/${lineId}/exception`,
    parsed,
    parseItemStateResult
  );
}

export async function proposeReplacementAction(
  tenantSlug: string,
  orderId: string,
  lineId: string,
  request: ReplacementProposalRequest
): Promise<WaiterActionResult<ReplacementProposalResult>> {
  const parsed = parseReplacementProposalRequest(request);
  if (!isWaiterUuid(orderId) || !isWaiterUuid(lineId) || !parsed) {
    return invalid();
  }
  return run(
    tenantSlug,
    `/v1/staff/orders/${orderId}/items/${lineId}/replacement`,
    parsed,
    parseReplacementProposalResult
  );
}

export async function decideReplacementAction(
  tenantSlug: string,
  adjustmentId: string,
  request: ReplacementDecisionRequest
): Promise<WaiterActionResult<ReplacementDecisionResult>> {
  const parsed = parseReplacementDecisionRequest(request);
  if (!isWaiterUuid(adjustmentId) || !parsed) return invalid();
  return run(
    tenantSlug,
    `/v1/staff/order-adjustments/${adjustmentId}/decision`,
    parsed,
    parseReplacementDecisionResult
  );
}

export async function cancelItemAction(
  tenantSlug: string,
  orderId: string,
  lineId: string,
  request: CancelItemRequest
): Promise<WaiterActionResult<CancelItemResult>> {
  const parsed = parseCancelItemRequest(request);
  if (!isWaiterUuid(orderId) || !isWaiterUuid(lineId) || !parsed) {
    return invalid();
  }
  return run(
    tenantSlug,
    `/v1/staff/orders/${orderId}/items/${lineId}/cancellation`,
    parsed,
    parseCancelItemResult
  );
}
