export type ProductionSector = "bar" | "kitchen";

export type ProductionItemStatus =
  | "cancelled"
  | "delivered"
  | "exception"
  | "preparing"
  | "queued"
  | "ready"
  | "replaced";

export type ProductionOrderStatus =
  | "cancelled"
  | "delivered"
  | "exception"
  | "in_preparation"
  | "queued"
  | "ready";

export type ProductionAdvanceTarget = "preparing" | "ready";

/**
 * Advancing an item carries only a command id and the next state. The order,
 * the line and the sector come from the route and the staff session; a client
 * never chooses its tenant, location, sector or role.
 */
export type ProductionAdvanceRequest = {
  commandId: string;
  status: ProductionAdvanceTarget;
};

export type ProductionAdvanceResult = {
  changed: boolean;
  lineId: string;
  orderId: string;
  orderStatus: ProductionOrderStatus;
  status: ProductionItemStatus;
};

export type ProductionTicketItem = {
  lineId: string;
  quantity: number;
  status: ProductionItemStatus;
  title: string;
  variantTitle: string | null;
};

/** The items of one order that belong to the viewer's own sector. */
export type ProductionTicket = {
  attribution: "individual" | "table";
  confirmedAt: string;
  dinerName: string | null;
  items: ProductionTicketItem[];
  orderId: string;
  /** Derived from every item of the order, whatever its sector. */
  orderStatus: ProductionOrderStatus;
  seatLabel: string | null;
  /** Derived from this sector's items only. */
  status: ProductionOrderStatus;
  tableId: string;
  tableLabel: string;
};

export type ProductionBoard = {
  generatedAt: string;
  sector: ProductionSector;
  tickets: ProductionTicket[];
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

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function bounded(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null;
}

function nullableBounded(
  value: unknown,
  maximumLength: number
): string | null | undefined {
  if (value === null) return null;
  return bounded(value, maximumLength) ?? undefined;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" &&
    !Number.isNaN(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
    ? value
    : null;
}

const itemStatuses: readonly ProductionItemStatus[] = [
  "queued",
  "preparing",
  "ready",
  "delivered",
  "exception",
  "cancelled",
  "replaced"
];

function itemStatus(value: unknown): ProductionItemStatus | null {
  return itemStatuses.find((status) => status === value) ?? null;
}

const orderStatuses: readonly ProductionOrderStatus[] = [
  "queued",
  "in_preparation",
  "ready",
  "delivered",
  "exception",
  "cancelled"
];

function orderStatus(value: unknown): ProductionOrderStatus | null {
  return orderStatuses.find((status) => status === value) ?? null;
}

export function parseProductionAdvanceRequest(
  input: unknown
): ProductionAdvanceRequest | null {
  const candidate = record(input);
  if (!candidate || !hasExactKeys(candidate, ["commandId", "status"])) {
    return null;
  }
  const commandId = uuid(candidate.commandId);
  if (
    !commandId ||
    (candidate.status !== "preparing" && candidate.status !== "ready")
  ) {
    return null;
  }
  return { commandId, status: candidate.status };
}

export function parseProductionAdvanceResult(
  input: unknown
): ProductionAdvanceResult | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "changed",
      "lineId",
      "orderId",
      "orderStatus",
      "status"
    ]) ||
    typeof root.changed !== "boolean"
  ) {
    return null;
  }
  const lineId = uuid(root.lineId);
  const orderId = uuid(root.orderId);
  const status = itemStatus(root.status);
  const derived = orderStatus(root.orderStatus);
  // An advance never leaves an item in the queue.
  if (!lineId || !orderId || !status || status === "queued" || !derived) {
    return null;
  }
  return {
    changed: root.changed,
    lineId,
    orderId,
    orderStatus: derived,
    status
  };
}

function ticketItem(input: unknown): ProductionTicketItem | null {
  const item = record(input);
  if (
    !item ||
    !hasExactKeys(item, [
      "lineId",
      "quantity",
      "status",
      "title",
      "variantTitle"
    ])
  ) {
    return null;
  }
  const lineId = uuid(item.lineId);
  const status = itemStatus(item.status);
  const title = bounded(item.title, 160);
  const variantTitle = nullableBounded(item.variantTitle, 160);
  if (
    !lineId ||
    !status ||
    !title ||
    variantTitle === undefined ||
    typeof item.quantity !== "number" ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > 20
  ) {
    return null;
  }
  return { lineId, quantity: item.quantity, status, title, variantTitle };
}

function ticket(input: unknown): ProductionTicket | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, [
      "attribution",
      "confirmedAt",
      "dinerName",
      "items",
      "orderId",
      "orderStatus",
      "seatLabel",
      "status",
      "tableId",
      "tableLabel"
    ]) ||
    (root.attribution !== "table" && root.attribution !== "individual") ||
    !Array.isArray(root.items) ||
    root.items.length < 1 ||
    root.items.length > 50
  ) {
    return null;
  }
  const items: ProductionTicketItem[] = [];
  for (const entry of root.items) {
    const parsed = ticketItem(entry);
    if (!parsed) return null;
    items.push(parsed);
  }
  const confirmedAt = timestamp(root.confirmedAt);
  const dinerName = nullableBounded(root.dinerName, 80);
  const seatLabel = nullableBounded(root.seatLabel, 40);
  const orderId = uuid(root.orderId);
  const tableId = uuid(root.tableId);
  const tableLabel = bounded(root.tableLabel, 80);
  const status = orderStatus(root.status);
  const derived = orderStatus(root.orderStatus);
  if (
    !confirmedAt ||
    dinerName === undefined ||
    seatLabel === undefined ||
    !orderId ||
    !tableId ||
    !tableLabel ||
    !status ||
    !derived
  ) {
    return null;
  }
  return {
    attribution: root.attribution,
    confirmedAt,
    dinerName,
    items,
    orderId,
    orderStatus: derived,
    seatLabel,
    status,
    tableId,
    tableLabel
  };
}

export function parseProductionBoard(input: unknown): ProductionBoard | null {
  const root = record(input);
  if (
    !root ||
    !hasExactKeys(root, ["generatedAt", "sector", "tickets"]) ||
    (root.sector !== "kitchen" && root.sector !== "bar") ||
    !Array.isArray(root.tickets) ||
    root.tickets.length > 200
  ) {
    return null;
  }
  const generatedAt = timestamp(root.generatedAt);
  if (!generatedAt) return null;
  const tickets: ProductionTicket[] = [];
  for (const entry of root.tickets) {
    const parsed = ticket(entry);
    if (!parsed) return null;
    tickets.push(parsed);
  }
  return { generatedAt, sector: root.sector, tickets };
}
