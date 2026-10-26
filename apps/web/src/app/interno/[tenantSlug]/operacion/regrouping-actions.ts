"use server";

import {
  isWaiterUuid,
  parseJoinTablesCommand,
  parseJoinTablesResult,
  parseSeparateTablesCommand,
  parseSeparateTablesResult,
  type JoinTablesCommand,
  type JoinTablesResult,
  type SeparateTablesCommand,
  type SeparateTablesResult
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

const invalid = () => failure("INVALID_TABLE_REGROUPING_REQUEST");

/** Joins tables: an open account follows the group and nothing is moved. */
export async function joinTablesAction(
  tenantSlug: string,
  request: JoinTablesCommand
): Promise<WaiterActionResult<JoinTablesResult>> {
  const parsed = parseJoinTablesCommand(request);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "/v1/staff/table-groups",
    parsed,
    parseJoinTablesResult
  );
}

/** Separates a group; the open account stays with the chosen anchor table. */
export async function separateTablesAction(
  tenantSlug: string,
  groupId: string,
  request: SeparateTablesCommand
): Promise<WaiterActionResult<SeparateTablesResult>> {
  const parsed = parseSeparateTablesCommand(request);
  if (!isWaiterUuid(groupId) || !parsed) return invalid();
  return run(
    tenantSlug,
    `/v1/staff/table-groups/${groupId}/separate`,
    parsed,
    parseSeparateTablesResult
  );
}
