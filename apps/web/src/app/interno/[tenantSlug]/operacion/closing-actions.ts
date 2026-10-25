"use server";

import {
  isWaiterUuid,
  parseAccountReceipt,
  parseCashierRequestResult,
  parseCleanTableResult,
  parseCloseAccountResult,
  parseResolveCashierRequestResult,
  parseTableClosingCommand,
  type AccountReceipt,
  type CashierRequestResult,
  type CleanTableResult,
  type CloseAccountResult,
  type ResolveCashierRequestResult,
  type TableClosingCommand
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
  method: "GET" | "POST",
  path: string,
  payload: unknown,
  parse: (data: unknown) => T | null
): Promise<WaiterActionResult<T>> {
  let response: Awaited<ReturnType<typeof callStaffApi>>;
  try {
    response = await callStaffApi(tenantSlug, method, path, payload);
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

const invalid = () => failure("INVALID_TABLE_CLOSING_REQUEST");

/** Closes a settled account: the table waits for cleaning, it is not freed. */
export async function closeAccountAction(
  tenantSlug: string,
  sessionId: string,
  request: TableClosingCommand
): Promise<WaiterActionResult<CloseAccountResult>> {
  const parsed = parseTableClosingCommand(request);
  if (!isWaiterUuid(sessionId) || !parsed) return invalid();
  return run(
    tenantSlug,
    "POST",
    `/v1/staff/accounts/${sessionId}/close`,
    parsed,
    parseCloseAccountResult
  );
}

/** Marks a table clean; only staff who serve it (or a manager) are accepted. */
export async function cleanTableAction(
  tenantSlug: string,
  tableId: string,
  request: TableClosingCommand
): Promise<WaiterActionResult<CleanTableResult>> {
  const parsed = parseTableClosingCommand(request);
  if (!isWaiterUuid(tableId) || !parsed) return invalid();
  return run(
    tenantSlug,
    "POST",
    `/v1/staff/tables/${tableId}/clean`,
    parsed,
    parseCleanTableResult
  );
}

/** "Avisar a caja": an internal request, never fiscal data. */
export async function requestCashierAction(
  tenantSlug: string,
  sessionId: string,
  request: TableClosingCommand
): Promise<WaiterActionResult<CashierRequestResult>> {
  const parsed = parseTableClosingCommand(request);
  if (!isWaiterUuid(sessionId) || !parsed) return invalid();
  return run(
    tenantSlug,
    "POST",
    `/v1/staff/accounts/${sessionId}/cashier-requests`,
    parsed,
    parseCashierRequestResult
  );
}

/** Manager only: the API and SQL refuse anyone else. */
export async function resolveCashierRequestAction(
  tenantSlug: string,
  requestId: string,
  request: TableClosingCommand
): Promise<WaiterActionResult<ResolveCashierRequestResult>> {
  const parsed = parseTableClosingCommand(request);
  if (!isWaiterUuid(requestId) || !parsed) return invalid();
  return run(
    tenantSlug,
    "POST",
    `/v1/staff/cashier-requests/${requestId}/resolve`,
    parsed,
    parseResolveCashierRequestResult
  );
}

export async function getReceiptAction(
  tenantSlug: string,
  sessionId: string
): Promise<WaiterActionResult<AccountReceipt>> {
  if (!isWaiterUuid(sessionId)) return invalid();
  return run(
    tenantSlug,
    "GET",
    `/v1/staff/accounts/${sessionId}/receipt`,
    undefined,
    parseAccountReceipt
  );
}
