"use server";

import {
  isWaiterUuid,
  parseManualOrderRequest,
  parseWaiterCallClaimRequest,
  parseWaiterCallClaimResult,
  parseWaiterIntentDecisionRequest,
  parseWaiterIntentDecisionResult,
  parseWaiterOrderResult,
  type WaiterCallClaimResult,
  type WaiterIntentDecisionRequest,
  type WaiterIntentDecisionResult,
  type WaiterManualOrderRequest,
  type WaiterOrderResult
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
  if ("sessionMissing" in response) return failure("STAFF_SESSION_INVALID");
  if (response.status === 401) return failure("STAFF_SESSION_INVALID");
  if (!response.ok) return failure(waiterErrorCode(response.body));
  const data = parse((response.body as { data?: unknown } | null)?.data);
  return data === null ? failure(null) : { data, status: "ok" };
}

export async function claimCallAction(
  tenantSlug: string,
  callId: string,
  commandId: string
): Promise<WaiterActionResult<WaiterCallClaimResult>> {
  const request = parseWaiterCallClaimRequest({ commandId });
  if (!isWaiterUuid(callId) || !request)
    return failure("INVALID_WAITER_REQUEST");
  return run(
    tenantSlug,
    `/v1/staff/calls/${callId}/claim`,
    request,
    parseWaiterCallClaimResult
  );
}

export async function decideIntentAction(
  tenantSlug: string,
  intentId: string,
  request: WaiterIntentDecisionRequest
): Promise<WaiterActionResult<WaiterIntentDecisionResult>> {
  const parsed = parseWaiterIntentDecisionRequest(request);
  if (!isWaiterUuid(intentId) || !parsed)
    return failure("INVALID_WAITER_REQUEST");
  return run(
    tenantSlug,
    `/v1/staff/order-intents/${intentId}/decisions`,
    parsed,
    parseWaiterIntentDecisionResult
  );
}

export async function createManualOrderAction(
  tenantSlug: string,
  request: WaiterManualOrderRequest
): Promise<WaiterActionResult<WaiterOrderResult>> {
  const parsed = parseManualOrderRequest(request);
  if (!parsed) return failure("INVALID_WAITER_REQUEST");
  return run(tenantSlug, "/v1/staff/orders", parsed, parseWaiterOrderResult);
}
