import type { OrderAttribution } from "./order-intent.js";

export type WaiterCallClaimRequest = { commandId: string };

export type WaiterIntentDecisionRequest =
  | { commandId: string; decision: "confirm"; reason: null }
  | { commandId: string; decision: "reject"; reason: string };

export type WaiterManualOrderItem = {
  lineId: string;
  productId: string;
  quantity: number;
  variantId: string | null;
};

/**
 * A manual order never carries prices, totals, tenant, location, staff or
 * payment data: the server resolves all of them from the published menu and
 * the staff session.
 */
export type WaiterManualOrderRequest = {
  attribution: OrderAttribution;
  commandId: string;
  dinerName: string | null;
  items: WaiterManualOrderItem[];
  seatLabel: string | null;
  tableId: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function text(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

export function isWaiterUuid(value: unknown): value is string {
  return uuid(value) !== null;
}

export function parseWaiterCallClaimRequest(
  input: unknown
): WaiterCallClaimRequest | null {
  const candidate = record(input);
  if (!candidate || !hasExactKeys(candidate, ["commandId"])) return null;
  const commandId = uuid(candidate.commandId);
  return commandId ? { commandId } : null;
}

export function parseWaiterIntentDecisionRequest(
  input: unknown
): WaiterIntentDecisionRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["commandId", "decision", "reason"])
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  if (!commandId) return null;
  if (candidate.decision === "confirm") {
    return candidate.reason === null
      ? { commandId, decision: "confirm", reason: null }
      : null;
  }
  if (candidate.decision === "reject") {
    const reason = text(candidate.reason, 200);
    return reason ? { commandId, decision: "reject", reason } : null;
  }
  return null;
}

export function parseManualOrderRequest(
  input: unknown
): WaiterManualOrderRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, [
      "attribution",
      "commandId",
      "dinerName",
      "items",
      "seatLabel",
      "tableId"
    ]) ||
    (candidate.attribution !== "table" &&
      candidate.attribution !== "individual") ||
    !Array.isArray(candidate.items) ||
    candidate.items.length < 1 ||
    candidate.items.length > 50
  ) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  const tableId = uuid(candidate.tableId);
  const dinerName =
    candidate.dinerName === null ? null : text(candidate.dinerName, 80);
  const seatLabel =
    candidate.seatLabel === null ? null : text(candidate.seatLabel, 40);
  if (
    !commandId ||
    !tableId ||
    (candidate.dinerName !== null && !dinerName) ||
    (candidate.seatLabel !== null && !seatLabel) ||
    (candidate.attribution === "individual" && (!dinerName || !seatLabel))
  ) {
    return null;
  }

  const items: WaiterManualOrderItem[] = [];
  const lineIds = new Set<string>();
  for (const value of candidate.items) {
    const item = record(value);
    if (
      !item ||
      !hasExactKeys(item, ["lineId", "productId", "quantity", "variantId"])
    ) {
      return null;
    }
    const lineId = uuid(item.lineId);
    const productId = uuid(item.productId);
    const variantId = item.variantId === null ? null : uuid(item.variantId);
    if (
      !lineId ||
      lineIds.has(lineId) ||
      !productId ||
      (item.variantId !== null && !variantId) ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 20
    ) {
      return null;
    }
    lineIds.add(lineId);
    items.push({ lineId, productId, quantity: item.quantity, variantId });
  }

  return {
    attribution: candidate.attribution,
    commandId,
    dinerName,
    items,
    seatLabel,
    tableId
  };
}

export type WaiterOrderItem = {
  lineId: string;
  productId: string;
  quantity: number;
  title: string;
  totalCents: number;
  unitPriceCents: number;
  variantId: string | null;
  variantTitle: string | null;
};

/**
 * Confirming an order is not charging it and is not producing it: payment stays
 * `not_recorded` and the account decision (charge now / keep the account open)
 * is a later, separate step owned by T22–T24. Production belongs to T20.
 */
export type WaiterOrderResult = {
  accountDecision: "pending";
  items: WaiterOrderItem[];
  orderId: string;
  payment: { state: "not_recorded" };
  source: "intent" | "manual";
  status: "confirmed";
  tableId: string;
  totalCents: number;
};

export type WaiterIntentDecisionResult =
  | { decision: "confirmed"; order: WaiterOrderResult }
  | { decision: "rejected"; intentId: string };

export type WaiterCallStatus = "acknowledged" | "open";

export type WaiterCallClaimResult = {
  callId: string;
  claimedByMe: boolean;
  status: WaiterCallStatus;
};

export type WaiterInPersonMethod =
  "cash" | "credit_card" | "debit_card" | "other_in_person";

export type WaiterCallView = {
  claimedByMe: boolean;
  claimedByName: string | null;
  createdAt: string;
  id: string;
  intentId: string;
  paymentMethod: WaiterInPersonMethod;
  reason: "order_validation";
  status: WaiterCallStatus;
  tableId: string;
  tableLabel: string;
};

export type WaiterIntentView = {
  attribution: OrderAttribution;
  callId: string;
  createdAt: string;
  dinerName: string;
  id: string;
  items: WaiterOrderItem[];
  paymentMethod: WaiterInPersonMethod;
  seatLabel: string | null;
  tableId: string;
  tableLabel: string;
  totalCents: number;
};

export type WaiterTableState =
  "available" | "needs_cleaning" | "occupied" | "out_of_service";

export type WaiterSalonUnit = {
  /** Always null until T22 introduces table sessions and the ledger. */
  balanceCents: null;
  floorId: string;
  id: string;
  kind: "group" | "table";
  label: string;
  name: string | null;
  openCalls: number;
  pendingIntents: number;
  sectorName: string;
  /** Always null until T22 introduces table sessions. */
  session: null;
  state: WaiterTableState;
  tables: { id: string; inScope: boolean; label: string }[];
};

export type WaiterSalonView = {
  calls: WaiterCallView[];
  floors: { id: string; name: string; shortName: string | null }[];
  generatedAt: string;
  intents: WaiterIntentView[];
  units: WaiterSalonUnit[];
};

const inPersonMethods = [
  "cash",
  "credit_card",
  "debit_card",
  "other_in_person"
] as const;
const tableStates = [
  "available",
  "needs_cleaning",
  "occupied",
  "out_of_service"
] as const;

function isoDate(value: unknown): string | null {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
    ? value
    : null;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function orderItem(value: unknown): WaiterOrderItem | null {
  const item = record(value);
  if (
    !item ||
    !hasExactKeys(item, [
      "lineId",
      "productId",
      "quantity",
      "title",
      "totalCents",
      "unitPriceCents",
      "variantId",
      "variantTitle"
    ])
  ) {
    return null;
  }
  const lineId = uuid(item.lineId);
  const productId = uuid(item.productId);
  const variantId = item.variantId === null ? null : uuid(item.variantId);
  const title = text(item.title, 160);
  const variantTitle =
    item.variantTitle === null ? null : text(item.variantTitle, 160);
  const unitPriceCents = cents(item.unitPriceCents);
  const totalCents = cents(item.totalCents);
  if (
    !lineId ||
    !productId ||
    (item.variantId !== null && !variantId) ||
    !title ||
    (item.variantTitle !== null && !variantTitle) ||
    typeof item.quantity !== "number" ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > 20 ||
    unitPriceCents === null ||
    totalCents === null ||
    totalCents !== unitPriceCents * item.quantity
  ) {
    return null;
  }
  return {
    lineId,
    productId,
    quantity: item.quantity,
    title,
    totalCents,
    unitPriceCents,
    variantId,
    variantTitle
  };
}

function orderItems(value: unknown): WaiterOrderItem[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    return null;
  }
  const items = value.map(orderItem);
  return items.every((item) => item !== null)
    ? (items as WaiterOrderItem[])
    : null;
}

export function parseWaiterOrderResult(
  input: unknown
): WaiterOrderResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "accountDecision",
      "items",
      "orderId",
      "payment",
      "source",
      "status",
      "tableId",
      "totalCents"
    ]) ||
    root.accountDecision !== "pending" ||
    root.status !== "confirmed" ||
    (root.source !== "intent" && root.source !== "manual")
  ) {
    return null;
  }
  const payment = record(root.payment);
  const items = orderItems(root.items);
  const orderId = uuid(root.orderId);
  const tableId = uuid(root.tableId);
  const totalCents = cents(root.totalCents);
  if (
    !payment ||
    !hasExactKeys(payment, ["state"]) ||
    payment.state !== "not_recorded" ||
    !items ||
    !orderId ||
    !tableId ||
    totalCents === null ||
    items.reduce((sum, line) => sum + line.totalCents, 0) !== totalCents
  ) {
    return null;
  }
  return {
    accountDecision: "pending",
    items,
    orderId,
    payment: { state: "not_recorded" },
    source: root.source,
    status: "confirmed",
    tableId,
    totalCents
  };
}

export function parseWaiterIntentDecisionResult(
  input: unknown
): WaiterIntentDecisionResult | null {
  const root = record(input);
  if (!root) return null;
  if (
    root.decision === "rejected" &&
    hasExactKeys(root, ["decision", "intentId"])
  ) {
    const intentId = uuid(root.intentId);
    return intentId ? { decision: "rejected", intentId } : null;
  }
  if (
    root.decision === "confirmed" &&
    hasExactKeys(root, ["decision", "order"])
  ) {
    const order = parseWaiterOrderResult(root.order);
    return order ? { decision: "confirmed", order } : null;
  }
  return null;
}

export function parseWaiterCallClaimResult(
  input: unknown
): WaiterCallClaimResult | null {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["callId", "claimedByMe", "status"])) {
    return null;
  }
  const callId = uuid(root.callId);
  const status = oneOf(root.status, ["acknowledged", "open"] as const);
  return callId && status && typeof root.claimedByMe === "boolean"
    ? { callId, claimedByMe: root.claimedByMe, status }
    : null;
}

function callView(value: unknown): WaiterCallView | null {
  const call = record(value);
  if (
    !call ||
    !hasExactKeys(call, [
      "claimedByMe",
      "claimedByName",
      "createdAt",
      "id",
      "intentId",
      "paymentMethod",
      "reason",
      "status",
      "tableId",
      "tableLabel"
    ])
  ) {
    return null;
  }
  const id = uuid(call.id);
  const intentId = uuid(call.intentId);
  const tableId = uuid(call.tableId);
  const createdAt = isoDate(call.createdAt);
  const status = oneOf(call.status, ["acknowledged", "open"] as const);
  const paymentMethod = oneOf(call.paymentMethod, inPersonMethods);
  const tableLabel = text(call.tableLabel, 20);
  const claimedByName =
    call.claimedByName === null ? null : text(call.claimedByName, 120);
  if (
    !id ||
    !intentId ||
    !tableId ||
    !createdAt ||
    !status ||
    !paymentMethod ||
    !tableLabel ||
    call.reason !== "order_validation" ||
    typeof call.claimedByMe !== "boolean" ||
    (call.claimedByName !== null && !claimedByName)
  ) {
    return null;
  }
  return {
    claimedByMe: call.claimedByMe,
    claimedByName,
    createdAt,
    id,
    intentId,
    paymentMethod,
    reason: "order_validation",
    status,
    tableId,
    tableLabel
  };
}

function intentView(value: unknown): WaiterIntentView | null {
  const intent = record(value);
  if (
    !intent ||
    !hasExactKeys(intent, [
      "attribution",
      "callId",
      "createdAt",
      "dinerName",
      "id",
      "items",
      "paymentMethod",
      "seatLabel",
      "tableId",
      "tableLabel",
      "totalCents"
    ])
  ) {
    return null;
  }
  const items = orderItems(intent.items);
  const id = uuid(intent.id);
  const callId = uuid(intent.callId);
  const tableId = uuid(intent.tableId);
  const createdAt = isoDate(intent.createdAt);
  const dinerName = text(intent.dinerName, 80);
  const seatLabel =
    intent.seatLabel === null ? null : text(intent.seatLabel, 40);
  const paymentMethod = oneOf(intent.paymentMethod, inPersonMethods);
  const tableLabel = text(intent.tableLabel, 20);
  const totalCents = cents(intent.totalCents);
  if (
    !items ||
    !id ||
    !callId ||
    !tableId ||
    !createdAt ||
    !dinerName ||
    (intent.seatLabel !== null && !seatLabel) ||
    !paymentMethod ||
    !tableLabel ||
    totalCents === null ||
    (intent.attribution !== "table" && intent.attribution !== "individual") ||
    items.reduce((sum, line) => sum + line.totalCents, 0) !== totalCents
  ) {
    return null;
  }
  return {
    attribution: intent.attribution,
    callId,
    createdAt,
    dinerName,
    id,
    items,
    paymentMethod,
    seatLabel,
    tableId,
    tableLabel,
    totalCents
  };
}

function unitView(value: unknown): WaiterSalonUnit | null {
  const unit = record(value);
  if (
    !unit ||
    !hasExactKeys(unit, [
      "balanceCents",
      "floorId",
      "id",
      "kind",
      "label",
      "name",
      "openCalls",
      "pendingIntents",
      "sectorName",
      "session",
      "state",
      "tables"
    ]) ||
    unit.balanceCents !== null ||
    unit.session !== null ||
    (unit.kind !== "group" && unit.kind !== "table") ||
    !Array.isArray(unit.tables) ||
    unit.tables.length < 1 ||
    unit.tables.length > 20
  ) {
    return null;
  }
  const floorId = uuid(unit.floorId);
  const id = uuid(unit.id);
  const label = text(unit.label, 120);
  const name = unit.name === null ? null : text(unit.name, 60);
  const sectorName = text(unit.sectorName, 60);
  const state = oneOf(unit.state, tableStates);
  const tables: WaiterSalonUnit["tables"] = [];
  for (const entry of unit.tables) {
    const table = record(entry);
    const tableId = table ? uuid(table.id) : null;
    const tableLabel = table ? text(table.label, 20) : null;
    if (
      !table ||
      !hasExactKeys(table, ["id", "inScope", "label"]) ||
      !tableId ||
      !tableLabel ||
      typeof table.inScope !== "boolean"
    ) {
      return null;
    }
    tables.push({ id: tableId, inScope: table.inScope, label: tableLabel });
  }
  const openCalls = cents(unit.openCalls);
  const pendingIntents = cents(unit.pendingIntents);
  if (
    !floorId ||
    !id ||
    !label ||
    (unit.name !== null && !name) ||
    !sectorName ||
    !state ||
    openCalls === null ||
    pendingIntents === null
  ) {
    return null;
  }
  return {
    balanceCents: null,
    floorId,
    id,
    kind: unit.kind,
    label,
    name,
    openCalls,
    pendingIntents,
    sectorName,
    session: null,
    state,
    tables
  };
}

export function parseWaiterSalonView(input: unknown): WaiterSalonView | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "calls",
      "floors",
      "generatedAt",
      "intents",
      "units"
    ]) ||
    !Array.isArray(root.calls) ||
    !Array.isArray(root.floors) ||
    !Array.isArray(root.intents) ||
    !Array.isArray(root.units)
  ) {
    return null;
  }
  const generatedAt = isoDate(root.generatedAt);
  const calls = root.calls.map(callView);
  const intents = root.intents.map(intentView);
  const units = root.units.map(unitView);
  const floors: WaiterSalonView["floors"] = [];
  for (const entry of root.floors) {
    const floor = record(entry);
    const id = floor ? uuid(floor.id) : null;
    const name = floor ? text(floor.name, 60) : null;
    const shortName =
      floor && floor.shortName !== null ? text(floor.shortName, 10) : null;
    if (
      !floor ||
      !hasExactKeys(floor, ["id", "name", "shortName"]) ||
      !id ||
      !name ||
      (floor.shortName !== null && !shortName)
    ) {
      return null;
    }
    floors.push({ id, name, shortName });
  }
  if (
    !generatedAt ||
    calls.some((call) => call === null) ||
    intents.some((intent) => intent === null) ||
    units.some((unit) => unit === null)
  ) {
    return null;
  }
  return {
    calls: calls as WaiterCallView[],
    floors,
    generatedAt,
    intents: intents as WaiterIntentView[],
    units: units as WaiterSalonUnit[]
  };
}
