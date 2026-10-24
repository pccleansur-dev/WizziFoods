"use server";

import {
  isWaiterUuid,
  parseApplyDiscountRequest,
  parseDiscountResult,
  parseKeepOpenRequest,
  parseKeepOpenResult,
  parsePaymentResult,
  parseRecordPaymentRequest,
  type ApplyDiscountRequest,
  type DiscountResult,
  type KeepOpenRequest,
  type KeepOpenResult,
  type PaymentResult,
  type RecordPaymentRequest
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

const invalid = () => failure("INVALID_ACCOUNT_REQUEST");

/** In-person collection of the whole balance or an amount, with an optional tip. */
export async function recordPaymentAction(
  tenantSlug: string,
  sessionId: string,
  request: RecordPaymentRequest
): Promise<WaiterActionResult<PaymentResult>> {
  const parsed = parseRecordPaymentRequest(request);
  if (!isWaiterUuid(sessionId) || !parsed) return invalid();
  return run(
    tenantSlug,
    `/v1/staff/accounts/${sessionId}/payments`,
    parsed,
    parsePaymentResult
  );
}

/** Manager only: the API and SQL refuse anyone else. */
export async function applyDiscountAction(
  tenantSlug: string,
  sessionId: string,
  request: ApplyDiscountRequest
): Promise<WaiterActionResult<DiscountResult>> {
  const parsed = parseApplyDiscountRequest(request);
  if (!isWaiterUuid(sessionId) || !parsed) return invalid();
  return run(
    tenantSlug,
    `/v1/staff/accounts/${sessionId}/discounts`,
    parsed,
    parseDiscountResult
  );
}

export async function keepAccountOpenAction(
  tenantSlug: string,
  sessionId: string,
  request: KeepOpenRequest
): Promise<WaiterActionResult<KeepOpenResult>> {
  const parsed = parseKeepOpenRequest(request);
  if (!isWaiterUuid(sessionId) || !parsed) return invalid();
  return run(
    tenantSlug,
    `/v1/staff/accounts/${sessionId}/keep-open`,
    parsed,
    parseKeepOpenResult
  );
}
