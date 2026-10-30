/** What a diner may ask for from the table screen. */
export const dinerWaiterCallReasons = [
  "call_waiter",
  "request_bill",
  "help"
] as const;

export type DinerWaiterCallReason = (typeof dinerWaiterCallReasons)[number];

/**
 * The diner sends the QR token and a reason, nothing else: tenant, location and
 * table are derived by the server from the host and the token.
 */
export type DinerWaiterCallRequest = {
  reason: DinerWaiterCallReason;
  token: string;
};

export type DinerWaiterCallResult = {
  callId: string;
  /** false when the table already had this call open and it was reused. */
  created: boolean;
  reason: DinerWaiterCallReason;
  /** open: nobody took it yet; acknowledged: a waiter is on the way. */
  status: "acknowledged" | "open";
};

const tokenPattern = /^[0-9a-f]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isDinerWaiterCallReason(
  value: unknown
): value is DinerWaiterCallReason {
  return (
    typeof value === "string" &&
    (dinerWaiterCallReasons as readonly string[]).includes(value)
  );
}

export function parseDinerWaiterCallRequest(
  input: unknown
): DinerWaiterCallRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    Object.keys(candidate).sort().join() !== "reason,token" ||
    !isDinerWaiterCallReason(candidate.reason) ||
    typeof candidate.token !== "string" ||
    !tokenPattern.test(candidate.token)
  ) {
    return null;
  }
  return { reason: candidate.reason, token: candidate.token };
}

export function parseDinerWaiterCallResult(
  input: unknown
): DinerWaiterCallResult | null {
  const root = record(input);
  if (
    !root ||
    Object.keys(root).sort().join() !== "callId,created,reason,status" ||
    typeof root.callId !== "string" ||
    !uuidPattern.test(root.callId) ||
    typeof root.created !== "boolean" ||
    !isDinerWaiterCallReason(root.reason) ||
    (root.status !== "open" && root.status !== "acknowledged")
  ) {
    return null;
  }
  return {
    callId: root.callId,
    created: root.created,
    reason: root.reason,
    status: root.status
  };
}
