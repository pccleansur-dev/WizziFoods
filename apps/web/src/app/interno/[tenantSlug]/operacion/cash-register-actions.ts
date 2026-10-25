"use server";

import {
  isWaiterUuid,
  parseCashMovementRequest,
  parseCashMovementResult,
  parseCloseShiftRequest,
  parseCloseShiftResult,
  parseOpenShiftRequest,
  parseOpenShiftResult,
  parseRefundRequest,
  parseRefundResult,
  type CashMovementRequest,
  type CashMovementResult,
  type CloseShiftRequest,
  type CloseShiftResult,
  type OpenShiftRequest,
  type OpenShiftResult,
  type RefundRequest,
  type RefundResult
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

const invalid = () => failure("INVALID_CASH_REGISTER_REQUEST");

/** Manager only: the API and SQL refuse anyone else. */
export async function openShiftAction(
  tenantSlug: string,
  request: OpenShiftRequest
): Promise<WaiterActionResult<OpenShiftResult>> {
  const parsed = parseOpenShiftRequest(request);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "/v1/staff/cash-register/open",
    parsed,
    parseOpenShiftResult
  );
}

export async function recordCashMovementAction(
  tenantSlug: string,
  request: CashMovementRequest
): Promise<WaiterActionResult<CashMovementResult>> {
  const parsed = parseCashMovementRequest(request);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "/v1/staff/cash-register/movements",
    parsed,
    parseCashMovementResult
  );
}

/** Blind count: only the counted cash travels, never the expected one. */
export async function closeShiftAction(
  tenantSlug: string,
  request: CloseShiftRequest
): Promise<WaiterActionResult<CloseShiftResult>> {
  const parsed = parseCloseShiftRequest(request);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "/v1/staff/cash-register/close",
    parsed,
    parseCloseShiftResult
  );
}

export async function recordRefundAction(
  tenantSlug: string,
  sessionId: string,
  request: RefundRequest
): Promise<WaiterActionResult<RefundResult>> {
  const parsed = parseRefundRequest(request);
  if (!isWaiterUuid(sessionId) || !parsed) return invalid();
  return run(
    tenantSlug,
    `/v1/staff/accounts/${sessionId}/refunds`,
    parsed,
    parseRefundResult
  );
}
