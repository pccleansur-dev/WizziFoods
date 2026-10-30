import {
  parseDinerWaiterCallResult,
  type DinerWaiterCallReason,
  type DinerWaiterCallResult
} from "@platform/contracts";

import type { TableEntry } from "./table-entry";

export type WaiterCallOutcome =
  | { result: DinerWaiterCallResult; status: "sent" }
  | { status: "error"; message: string };

/** What the diner reads on each reason button. */
export const waiterCallLabels: Record<
  DinerWaiterCallReason,
  { button: string; sent: string; sentAttended: string }
> = {
  call_waiter: {
    button: "Llamar al mozo",
    sent: "Avisamos al mozo. Ya viene.",
    sentAttended: "El mozo ya está yendo a tu mesa."
  },
  help: {
    button: "Necesito ayuda",
    sent: "Avisamos al mozo que necesitás ayuda. Ya viene.",
    sentAttended: "El mozo ya está yendo a tu mesa."
  },
  request_bill: {
    button: "Pedir la cuenta",
    sent: "Avisamos al mozo que querés la cuenta. Ya te la lleva.",
    sentAttended: "El mozo ya está yendo a tu mesa con la cuenta."
  }
};

/**
 * The reasons offered on this table. Asking for the bill only makes sense once
 * the table is open: the server refuses it otherwise.
 */
export function waiterCallReasons(
  entry: Pick<TableEntry, "canCallWaiter" | "mode">
): DinerWaiterCallReason[] {
  if (!entry.canCallWaiter) return [];
  return entry.mode === "join"
    ? ["call_waiter", "request_bill", "help"]
    : ["call_waiter", "help"];
}

const failureMessages: Record<string, string> = {
  WAITER_CALL_NO_OPEN_TABLE:
    "Todavía no hay una cuenta abierta en esta mesa. Llamá al mozo para que te atienda.",
  WAITER_CALL_RATE_LIMITED:
    "Ya avisamos varias veces desde esta mesa. Esperá un momento: el mozo ya está al tanto.",
  WAITER_CALL_TABLE_CHANGED:
    "Ahora no podemos avisar al mozo desde esta mesa. Escaneá nuevamente el QR o pedile ayuda al personal."
};

export const waiterCallFailureMessage =
  "No pudimos avisar al mozo. Probá de nuevo o levantá la mano.";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function waiterCallFailure(body: unknown): string {
  const error = record(record(body)?.error);
  const code = typeof error?.code === "string" ? error.code : "";
  return failureMessages[code] ?? waiterCallFailureMessage;
}

/** Sends the call. Only the token and the reason leave the device. */
export async function sendWaiterCall(
  token: string,
  reason: DinerWaiterCallReason,
  fetcher: typeof fetch = fetch
): Promise<WaiterCallOutcome> {
  try {
    const response = await fetcher("/api/waiter-calls", {
      body: JSON.stringify({ reason, token }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return { message: waiterCallFailure(body), status: "error" };
    }
    const result = parseDinerWaiterCallResult(record(body)?.data);
    return result
      ? { result, status: "sent" }
      : { message: waiterCallFailureMessage, status: "error" };
  } catch {
    return { message: waiterCallFailureMessage, status: "error" };
  }
}
