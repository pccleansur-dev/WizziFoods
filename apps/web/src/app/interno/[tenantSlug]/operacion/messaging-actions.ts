"use server";

import {
  isWaiterUuid,
  parseConnectWhatsappRequest,
  parseDecideAutomationRequest,
  parseDecideOneOffRequest,
  parseDecidedOneOff,
  parseMessagingAudience,
  parseMessagingEvents,
  parseMessagingOverview,
  parseProposeOneOffRequest,
  parseProposedOneOff,
  parseSaveAutomationRequest,
  parseSetTemplateCostRequest,
  type ConnectWhatsappRequest,
  type DecideAutomationRequest,
  type DecideOneOffRequest,
  type DecidedOneOff,
  type MessagingAudienceMember,
  type MessagingEvent,
  type MessagingOverview,
  type ProposeOneOffRequest,
  type ProposedOneOff,
  type SaveAutomationRequest
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
  method: "DELETE" | "GET" | "POST" | "PUT",
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

const invalid = () => failure("INVALID_MESSAGING_REQUEST");
const base = "/v1/staff/messaging";

export async function getMessagingAction(
  tenantSlug: string
): Promise<WaiterActionResult<MessagingOverview>> {
  return run(tenantSlug, "GET", base, undefined, parseMessagingOverview);
}

export async function getMessagingEventsAction(
  tenantSlug: string
): Promise<WaiterActionResult<MessagingEvent[]>> {
  return run(
    tenantSlug,
    "GET",
    `${base}/events?limit=50`,
    undefined,
    parseMessagingEvents
  );
}

export async function getMessagingAudienceAction(
  tenantSlug: string
): Promise<WaiterActionResult<MessagingAudienceMember[]>> {
  return run(
    tenantSlug,
    "GET",
    `${base}/audience`,
    undefined,
    parseMessagingAudience
  );
}

/** The token goes to the API once and is never shown again. */
export async function connectWhatsappAction(
  tenantSlug: string,
  request: ConnectWhatsappRequest
): Promise<WaiterActionResult<MessagingOverview>> {
  const parsed = parseConnectWhatsappRequest(request);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "PUT",
    `${base}/connection`,
    parsed,
    parseMessagingOverview
  );
}

export async function disconnectWhatsappAction(
  tenantSlug: string
): Promise<WaiterActionResult<MessagingOverview>> {
  return run(
    tenantSlug,
    "DELETE",
    `${base}/connection`,
    undefined,
    parseMessagingOverview
  );
}

export async function setSendingAction(
  tenantSlug: string,
  enabled: boolean
): Promise<WaiterActionResult<MessagingOverview>> {
  return run(
    tenantSlug,
    "PUT",
    `${base}/sending`,
    { enabled: enabled === true },
    parseMessagingOverview
  );
}

export async function syncTemplatesAction(
  tenantSlug: string
): Promise<WaiterActionResult<MessagingOverview>> {
  return run(
    tenantSlug,
    "POST",
    `${base}/templates/sync`,
    undefined,
    parseMessagingOverview
  );
}

export async function setTemplateCostAction(
  tenantSlug: string,
  templateId: string,
  estimatedCostCents: number
): Promise<WaiterActionResult<MessagingOverview>> {
  const parsed = parseSetTemplateCostRequest({ estimatedCostCents });
  if (!parsed || !isWaiterUuid(templateId)) return invalid();
  return run(
    tenantSlug,
    "PUT",
    `${base}/templates/${templateId}/cost`,
    parsed,
    parseMessagingOverview
  );
}

export async function saveAutomationAction(
  tenantSlug: string,
  request: SaveAutomationRequest
): Promise<WaiterActionResult<MessagingOverview>> {
  const parsed = parseSaveAutomationRequest(request);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "PUT",
    `${base}/automations`,
    parsed,
    parseMessagingOverview
  );
}

export async function decideAutomationAction(
  tenantSlug: string,
  automationId: string,
  request: DecideAutomationRequest
): Promise<WaiterActionResult<MessagingOverview>> {
  const parsed = parseDecideAutomationRequest(request);
  if (!parsed || !isWaiterUuid(automationId)) return invalid();
  return run(
    tenantSlug,
    "POST",
    `${base}/automations/${automationId}/decision`,
    parsed,
    parseMessagingOverview
  );
}

export async function proposeOneOffAction(
  tenantSlug: string,
  request: ProposeOneOffRequest
): Promise<WaiterActionResult<ProposedOneOff>> {
  const parsed = parseProposeOneOffRequest(request);
  if (!parsed) return invalid();
  return run(
    tenantSlug,
    "POST",
    `${base}/one-off-events`,
    parsed,
    parseProposedOneOff
  );
}

export async function decideOneOffAction(
  tenantSlug: string,
  batchId: string,
  request: DecideOneOffRequest
): Promise<WaiterActionResult<DecidedOneOff>> {
  const parsed = parseDecideOneOffRequest(request);
  if (!parsed || !isWaiterUuid(batchId)) return invalid();
  return run(
    tenantSlug,
    "POST",
    `${base}/one-off-events/${batchId}/decision`,
    parsed,
    parseDecidedOneOff
  );
}
