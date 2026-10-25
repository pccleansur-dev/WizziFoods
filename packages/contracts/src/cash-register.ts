import type { AccountPaymentMethod } from "./table-accounts.js";

/**
 * None of these requests carries a tenant, location, role, shift, currency or an
 * expected amount, and none can hold a card number, expiry or security code:
 * physical cards only ever record their method.
 */
export type OpenShiftRequest = { commandId: string; openingCashCents: number };

export type CashMovementKind = "cash_in" | "cash_out";

export type CashMovementRequest = {
  amountCents: number;
  commandId: string;
  kind: CashMovementKind;
  reason: string;
};

/** Blind count: only what was counted, plus a justification when it differs. */
export type CloseShiftRequest = {
  commandId: string;
  countedCashCents: number;
  reason: string | null;
};

export type RefundRequest = {
  amountCents: number;
  commandId: string;
  itemLineId: string | null;
  paymentId: string;
  reason: string;
};

export type OpenShiftResult = {
  openedAt: string;
  openingCashCents: number;
  shiftId: string;
};

export type CashMovementResult = {
  amountCents: number;
  kind: CashMovementKind;
  movementId: string;
  shiftId: string;
};

export type RefundResult = {
  paymentId: string;
  pendingCents: number;
  refundCents: number;
  sessionId: string;
  shiftId: string;
};

export type ShiftBreakdown = {
  manualInCents: number;
  manualOutCents: number;
  methods: Partial<
    Record<
      AccountPaymentMethod,
      { receivedCents: number; refundedCents: number }
    >
  >;
  tipCents: number;
};

export type CloseShiftResult =
  | { closed: false; differenceCents: number; shiftId: string }
  | {
      breakdown: ShiftBreakdown;
      closed: true;
      countedCashCents: number;
      differenceCents: number;
      expectedCashCents: number;
      pendingAccounts: number;
      pendingCents: number;
      reason: string | null;
      shiftId: string;
    };

export type CashShiftClosure = {
  breakdown: ShiftBreakdown;
  closedAt: string;
  closedByName: string;
  countedCashCents: number;
  differenceCents: number;
  expectedCashCents: number;
  openedAt: string;
  openedByName: string;
  openingCashCents: number;
  pendingAccounts: number;
  pendingCents: number;
  reason: string | null;
  shiftId: string;
};

export type CashMovementView = {
  amountCents: number;
  createdAt: string;
  id: string;
  kind: CashMovementKind;
  reason: string;
};

/** While open, the register never reveals the cash the drawer should hold. */
export type CashRegisterState =
  | { open: false }
  | {
      movements: CashMovementView[];
      open: true;
      openedAt: string;
      openedByName: string;
      openingCashCents: number;
      paymentCount: number;
      refundCount: number;
      shiftId: string;
    };

export type CashRegisterView = {
  canManage: boolean;
  closures: CashShiftClosure[];
  generatedAt: string;
  register: CashRegisterState;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const maximumCents = 1_000_000_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[]
): boolean {
  return Object.keys(value).sort().join("\0") === expected.sort().join("\0");
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function cents(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 && parsed <= maximumCents
    ? parsed
    : null;
}

function positiveCents(value: unknown): number | null {
  const parsed = cents(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function reason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null;
}

function bounded(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
    ? value
    : null;
}

function movementKind(value: unknown): CashMovementKind | null {
  return value === "cash_in" || value === "cash_out" ? value : null;
}

export function parseOpenShiftRequest(input: unknown): OpenShiftRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["commandId", "openingCashCents"])
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  const openingCashCents = cents(candidate.openingCashCents);
  return commandId && openingCashCents !== null
    ? { commandId, openingCashCents }
    : null;
}

export function parseCashMovementRequest(
  input: unknown
): CashMovementRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["amountCents", "commandId", "kind", "reason"])
  ) {
    return null;
  }
  const amountCents = positiveCents(candidate.amountCents);
  const commandId = uuid(candidate.commandId);
  const kind = movementKind(candidate.kind);
  const text = reason(candidate.reason);
  return amountCents !== null && commandId && kind && text
    ? { amountCents, commandId, kind, reason: text }
    : null;
}

export function parseCloseShiftRequest(
  input: unknown
): CloseShiftRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["commandId", "countedCashCents", "reason"])
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  const countedCashCents = cents(candidate.countedCashCents);
  const text = candidate.reason === null ? null : reason(candidate.reason);
  if (
    !commandId ||
    countedCashCents === null ||
    (candidate.reason !== null && !text)
  ) {
    return null;
  }
  return { commandId, countedCashCents, reason: text };
}

export function parseRefundRequest(input: unknown): RefundRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, [
      "amountCents",
      "commandId",
      "itemLineId",
      "paymentId",
      "reason"
    ])
  ) {
    return null;
  }
  const amountCents = positiveCents(candidate.amountCents);
  const commandId = uuid(candidate.commandId);
  const paymentId = uuid(candidate.paymentId);
  const itemLineId =
    candidate.itemLineId === null ? null : uuid(candidate.itemLineId);
  const text = reason(candidate.reason);
  if (
    amountCents === null ||
    !commandId ||
    !paymentId ||
    !text ||
    (candidate.itemLineId !== null && !itemLineId)
  ) {
    return null;
  }
  return { amountCents, commandId, itemLineId, paymentId, reason: text };
}

export function parseOpenShiftResult(input: unknown): OpenShiftResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["openedAt", "openingCashCents", "shiftId"])
  ) {
    return null;
  }
  const openedAt = timestamp(root.openedAt);
  const openingCashCents = cents(root.openingCashCents);
  const shiftId = uuid(root.shiftId);
  return openedAt && openingCashCents !== null && shiftId
    ? { openedAt, openingCashCents, shiftId }
    : null;
}

export function parseCashMovementResult(
  input: unknown
): CashMovementResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["amountCents", "kind", "movementId", "shiftId"])
  ) {
    return null;
  }
  const amountCents = positiveCents(root.amountCents);
  const kind = movementKind(root.kind);
  const movementId = uuid(root.movementId);
  const shiftId = uuid(root.shiftId);
  return amountCents !== null && kind && movementId && shiftId
    ? { amountCents, kind, movementId, shiftId }
    : null;
}

export function parseRefundResult(input: unknown): RefundResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "paymentId",
      "pendingCents",
      "refundCents",
      "sessionId",
      "shiftId"
    ])
  ) {
    return null;
  }
  const paymentId = uuid(root.paymentId);
  const pendingCents = integer(root.pendingCents);
  const refundCents = positiveCents(root.refundCents);
  const sessionId = uuid(root.sessionId);
  const shiftId = uuid(root.shiftId);
  return paymentId &&
    pendingCents !== null &&
    refundCents !== null &&
    sessionId &&
    shiftId
    ? { paymentId, pendingCents, refundCents, sessionId, shiftId }
    : null;
}

const methodKeys: readonly AccountPaymentMethod[] = [
  "cash",
  "credit_card",
  "debit_card",
  "other_in_person"
];

function breakdown(input: unknown): ShiftBreakdown | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "manualInCents",
      "manualOutCents",
      "methods",
      "tipCents"
    ])
  ) {
    return null;
  }
  const manualInCents = cents(root.manualInCents);
  const manualOutCents = cents(root.manualOutCents);
  const tipCents = cents(root.tipCents);
  const methods = record(root.methods);
  if (
    manualInCents === null ||
    manualOutCents === null ||
    tipCents === null ||
    !methods
  ) {
    return null;
  }
  const parsed: ShiftBreakdown["methods"] = {};
  for (const [key, value] of Object.entries(methods)) {
    const method = methodKeys.find((candidate) => candidate === key);
    const totals = record(value);
    if (
      !method ||
      !totals ||
      !hasExactKeys(totals, ["receivedCents", "refundedCents"])
    ) {
      return null;
    }
    const receivedCents = cents(totals.receivedCents);
    const refundedCents = cents(totals.refundedCents);
    if (receivedCents === null || refundedCents === null) return null;
    parsed[method] = { receivedCents, refundedCents };
  }
  return { manualInCents, manualOutCents, methods: parsed, tipCents };
}

export function parseCloseShiftResult(input: unknown): CloseShiftResult | null {
  const root = record(input);
  if (!root) return null;
  if (root.closed === false) {
    if (!hasExactKeys(root, ["closed", "differenceCents", "shiftId"])) {
      return null;
    }
    const differenceCents = integer(root.differenceCents);
    const shiftId = uuid(root.shiftId);
    return differenceCents !== null && differenceCents !== 0 && shiftId
      ? { closed: false, differenceCents, shiftId }
      : null;
  }
  if (
    root.closed !== true ||
    !hasExactKeys(root, [
      "breakdown",
      "closed",
      "countedCashCents",
      "differenceCents",
      "expectedCashCents",
      "pendingAccounts",
      "pendingCents",
      "reason",
      "shiftId"
    ])
  ) {
    return null;
  }
  const parsedBreakdown = breakdown(root.breakdown);
  const countedCashCents = cents(root.countedCashCents);
  const differenceCents = integer(root.differenceCents);
  const expectedCashCents = integer(root.expectedCashCents);
  const pendingAccounts = cents(root.pendingAccounts);
  const pendingCents = integer(root.pendingCents);
  const text = root.reason === null ? null : reason(root.reason);
  const shiftId = uuid(root.shiftId);
  if (
    !parsedBreakdown ||
    countedCashCents === null ||
    differenceCents === null ||
    expectedCashCents === null ||
    pendingAccounts === null ||
    pendingCents === null ||
    (root.reason !== null && !text) ||
    !shiftId ||
    differenceCents !== countedCashCents - expectedCashCents ||
    // A difference is only accepted with its justification.
    (differenceCents !== 0 && text === null)
  ) {
    return null;
  }
  return {
    breakdown: parsedBreakdown,
    closed: true,
    countedCashCents,
    differenceCents,
    expectedCashCents,
    pendingAccounts,
    pendingCents,
    reason: text,
    shiftId
  };
}

function closure(input: unknown): CashShiftClosure | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "breakdown",
      "closedAt",
      "closedByName",
      "countedCashCents",
      "differenceCents",
      "expectedCashCents",
      "openedAt",
      "openedByName",
      "openingCashCents",
      "pendingAccounts",
      "pendingCents",
      "reason",
      "shiftId"
    ])
  ) {
    return null;
  }
  const parsedBreakdown = breakdown(root.breakdown);
  const closedAt = timestamp(root.closedAt);
  const closedByName = bounded(root.closedByName, 80);
  const countedCashCents = cents(root.countedCashCents);
  const differenceCents = integer(root.differenceCents);
  const expectedCashCents = integer(root.expectedCashCents);
  const openedAt = timestamp(root.openedAt);
  const openedByName = bounded(root.openedByName, 80);
  const openingCashCents = cents(root.openingCashCents);
  const pendingAccounts = cents(root.pendingAccounts);
  const pendingCents = integer(root.pendingCents);
  const text = root.reason === null ? null : reason(root.reason);
  const shiftId = uuid(root.shiftId);
  if (
    !parsedBreakdown ||
    !closedAt ||
    !closedByName ||
    countedCashCents === null ||
    differenceCents === null ||
    expectedCashCents === null ||
    !openedAt ||
    !openedByName ||
    openingCashCents === null ||
    pendingAccounts === null ||
    pendingCents === null ||
    (root.reason !== null && !text) ||
    !shiftId ||
    differenceCents !== countedCashCents - expectedCashCents ||
    (differenceCents !== 0 && text === null)
  ) {
    return null;
  }
  return {
    breakdown: parsedBreakdown,
    closedAt,
    closedByName,
    countedCashCents,
    differenceCents,
    expectedCashCents,
    openedAt,
    openedByName,
    openingCashCents,
    pendingAccounts,
    pendingCents,
    reason: text,
    shiftId
  };
}

function register(input: unknown): CashRegisterState | null {
  const root = record(input);
  if (!root) return null;
  if (root.open === false) {
    return hasExactKeys(root, ["open"]) ? { open: false } : null;
  }
  if (
    root.open !== true ||
    !hasExactKeys(root, [
      "movements",
      "open",
      "openedAt",
      "openedByName",
      "openingCashCents",
      "paymentCount",
      "refundCount",
      "shiftId"
    ]) ||
    !Array.isArray(root.movements) ||
    root.movements.length > 200
  ) {
    return null;
  }
  const movements: CashMovementView[] = [];
  for (const entry of root.movements) {
    const movement = record(entry);
    if (
      !movement ||
      !hasExactKeys(movement, [
        "amountCents",
        "createdAt",
        "id",
        "kind",
        "reason"
      ])
    ) {
      return null;
    }
    const amountCents = positiveCents(movement.amountCents);
    const createdAt = timestamp(movement.createdAt);
    const id = uuid(movement.id);
    const kind = movementKind(movement.kind);
    const text = bounded(movement.reason, 200);
    if (amountCents === null || !createdAt || !id || !kind || !text)
      return null;
    movements.push({ amountCents, createdAt, id, kind, reason: text });
  }
  const openedAt = timestamp(root.openedAt);
  const openedByName = bounded(root.openedByName, 80);
  const openingCashCents = cents(root.openingCashCents);
  const paymentCount = cents(root.paymentCount);
  const refundCount = cents(root.refundCount);
  const shiftId = uuid(root.shiftId);
  if (
    !openedAt ||
    !openedByName ||
    openingCashCents === null ||
    paymentCount === null ||
    refundCount === null ||
    !shiftId
  ) {
    return null;
  }
  return {
    movements,
    open: true,
    openedAt,
    openedByName,
    openingCashCents,
    paymentCount,
    refundCount,
    shiftId
  };
}

export function parseCashRegisterView(input: unknown): CashRegisterView | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["canManage", "closures", "generatedAt", "register"]) ||
    typeof root.canManage !== "boolean" ||
    !Array.isArray(root.closures) ||
    root.closures.length > 50
  ) {
    return null;
  }
  const closures: CashShiftClosure[] = [];
  for (const entry of root.closures) {
    const parsed = closure(entry);
    if (!parsed) return null;
    closures.push(parsed);
  }
  const generatedAt = timestamp(root.generatedAt);
  const state = register(root.register);
  return generatedAt && state
    ? { canManage: root.canManage, closures, generatedAt, register: state }
    : null;
}
