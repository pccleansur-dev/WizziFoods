"use server";

import {
  isWaiterUuid,
  parseLoyaltySettings,
  parseRedeemRewardRequest,
  parseRedeemRewardResult,
  parseSessionRewards,
  type LoyaltySettings,
  type RedeemRewardRequest,
  type RedeemRewardResult,
  type SessionReward
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
  method: "GET" | "POST" | "PUT",
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

const invalid = () => failure("INVALID_LOYALTY_REQUEST");

/** Rewards a diner is holding for this account, as the till shows them. */
export async function getSessionRewardsAction(
  tenantSlug: string,
  sessionId: string
): Promise<WaiterActionResult<SessionReward[]>> {
  if (!isWaiterUuid(sessionId)) return invalid();
  return run(
    tenantSlug,
    "GET",
    `/v1/staff/accounts/${sessionId}/rewards`,
    undefined,
    parseSessionRewards
  );
}

/** Discount + payment + redemption in one step; the amount is never sent. */
export async function redeemRewardAction(
  tenantSlug: string,
  sessionId: string,
  request: RedeemRewardRequest
): Promise<WaiterActionResult<RedeemRewardResult>> {
  const parsed = parseRedeemRewardRequest(request);
  if (!isWaiterUuid(sessionId) || !parsed) return invalid();
  return run(
    tenantSlug,
    "POST",
    `/v1/staff/accounts/${sessionId}/reward-redemptions`,
    parsed,
    parseRedeemRewardResult
  );
}

export async function getLoyaltySettingsAction(
  tenantSlug: string
): Promise<WaiterActionResult<LoyaltySettings>> {
  return run(
    tenantSlug,
    "GET",
    "/v1/staff/loyalty/settings",
    undefined,
    parseLoyaltySettings
  );
}

export async function saveLoyaltySettingsAction(
  tenantSlug: string,
  settings: LoyaltySettings
): Promise<WaiterActionResult<LoyaltySettings>> {
  const parsed = parseLoyaltySettings(settings);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "PUT",
    "/v1/staff/loyalty/settings",
    parsed,
    parseLoyaltySettings
  );
}
