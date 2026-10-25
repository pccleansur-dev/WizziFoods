import {
  parseAccountSummary,
  type AccountEntryPaymentMethod,
  type AccountSummary
} from "./table-accounts.js";

/** Every receipt carries both texts word for word; it is never a tax document. */
export const RECEIPT_NOTICE = "Comprobante de consumo — no válido como factura";
export const RECEIPT_INVOICE_NOTICE =
  "¿Necesitás factura? Por el momento, la facturación se realiza en caja";

/** Closing, cleaning and notifying the cashier all carry only their command id. */
export type TableClosingCommand = { commandId: string };

export type ReceiptItem = {
  lineId: string;
  quantity: number;
  title: string;
  totalCents: number;
};

export type ReceiptMoney = {
  amountCents: number;
  method: AccountEntryPaymentMethod | null;
};

export type CashierRequestStatus = "open" | "resolved";

export type CashierRequestState = {
  requestId: string;
  status: CashierRequestStatus;
};

export type AccountReceipt = {
  businessName: string;
  cashierRequest: CashierRequestState | null;
  closedAt: string;
  currency: "ARS";
  discounts: { amountCents: number; cause: string }[];
  invoiceNotice: typeof RECEIPT_INVOICE_NOTICE;
  items: ReceiptItem[];
  locationName: string;
  notice: typeof RECEIPT_NOTICE;
  number: number;
  openedAt: string;
  payments: ReceiptMoney[];
  refunds: ReceiptMoney[];
  sessionId: string;
  summary: AccountSummary;
  tableLabels: string[];
};

export type ClosedTable = {
  label: string;
  /** Closing never frees a table: it always waits for cleaning. */
  state: "needs_cleaning";
  tableId: string;
};

export type CloseAccountResult = {
  closedAt: string;
  receipt: AccountReceipt;
  sessionId: string;
  tables: ClosedTable[];
};

export type CleanTableResult = { state: "available"; tableId: string };

export type CashierRequestResult = {
  receiptNumber: number;
  requestId: string;
  sessionId: string;
  status: "open";
};

export type ResolveCashierRequestResult = {
  requestId: string;
  status: "resolved";
};

export type ClosedAccount = {
  cashierRequest: CashierRequestState | null;
  closedAt: string;
  receiptNumber: number;
  sessionId: string;
  tableLabels: string[];
  totalCents: number;
};

export type ClosedAccountsView = {
  accounts: ClosedAccount[];
  generatedAt: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methods: readonly AccountEntryPaymentMethod[] = [
  "cash",
  "credit_card",
  "debit_card",
  "mercado_pago",
  "other_in_person"
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
  );
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function text(value: unknown, maximumLength: number): string | null {
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

function list<T>(
  input: unknown,
  parse: (item: unknown) => T | null
): T[] | null {
  if (!Array.isArray(input)) return null;
  const parsed: T[] = [];
  for (const item of input) {
    const value = parse(item);
    if (value === null) return null;
    parsed.push(value);
  }
  return parsed;
}

function labels(input: unknown): string[] | null {
  return list(input, (label) => text(label, 80));
}

function cashierRequest(input: unknown): CashierRequestState | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["requestId", "status"])) return null;
  const requestId = uuid(root.requestId);
  return requestId && (root.status === "open" || root.status === "resolved")
    ? { requestId, status: root.status }
    : null;
}

function money(input: unknown): ReceiptMoney | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["amountCents", "method"])) return null;
  const amountCents = integer(root.amountCents);
  const method =
    root.method === null
      ? null
      : (methods.find((candidate) => candidate === root.method) ?? undefined);
  return amountCents !== null && amountCents > 0 && method !== undefined
    ? { amountCents, method }
    : null;
}

function receiptItem(input: unknown): ReceiptItem | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, ["lineId", "quantity", "title", "totalCents"])
  ) {
    return null;
  }
  const lineId = uuid(root.lineId);
  const quantity = integer(root.quantity);
  const title = text(root.title, 160);
  const totalCents = integer(root.totalCents);
  return lineId &&
    quantity !== null &&
    quantity > 0 &&
    title &&
    totalCents !== null &&
    totalCents >= 0
    ? { lineId, quantity, title, totalCents }
    : null;
}

function discount(
  input: unknown
): { amountCents: number; cause: string } | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["amountCents", "cause"])) return null;
  const amountCents = integer(root.amountCents);
  const cause = text(root.cause, 200);
  return amountCents !== null && amountCents > 0 && cause
    ? { amountCents, cause }
    : null;
}

export function parseTableClosingCommand(
  input: unknown
): TableClosingCommand | null {
  const candidate = record(input);
  if (!candidate || !exactKeys(candidate, ["commandId"])) return null;
  const commandId = uuid(candidate.commandId);
  return commandId ? { commandId } : null;
}

const receiptKeys = [
  "businessName",
  "closedAt",
  "currency",
  "discounts",
  "invoiceNotice",
  "items",
  "locationName",
  "notice",
  "number",
  "openedAt",
  "payments",
  "refunds",
  "sessionId",
  "summary",
  "tableLabels"
];

/**
 * A receipt is only canonical with both notices, a balance of exactly zero and no
 * field beyond the ones listed: there is no room for a tax id, legal name or address.
 */
export function parseAccountReceipt(input: unknown): AccountReceipt | null {
  const root = record(input);
  if (!root) return null;
  const hasRequest = "cashierRequest" in root;
  if (
    !exactKeys(
      root,
      hasRequest ? [...receiptKeys, "cashierRequest"] : receiptKeys
    ) ||
    root.notice !== RECEIPT_NOTICE ||
    root.invoiceNotice !== RECEIPT_INVOICE_NOTICE ||
    root.currency !== "ARS"
  ) {
    return null;
  }
  const request =
    !hasRequest || root.cashierRequest === null
      ? null
      : cashierRequest(root.cashierRequest);
  if (hasRequest && root.cashierRequest !== null && request === null) {
    return null;
  }
  const businessName = text(root.businessName, 200);
  const locationName = text(root.locationName, 200);
  const closedAt = timestamp(root.closedAt);
  const openedAt = timestamp(root.openedAt);
  const number = integer(root.number);
  const sessionId = uuid(root.sessionId);
  const summary = parseAccountSummary(root.summary);
  const tableLabels = labels(root.tableLabels);
  const items = list(root.items, receiptItem);
  const discounts = list(root.discounts, discount);
  const payments = list(root.payments, money);
  const refunds = list(root.refunds, money);
  if (
    !businessName ||
    !locationName ||
    !closedAt ||
    !openedAt ||
    number === null ||
    number < 1 ||
    !sessionId ||
    !summary ||
    summary.pendingCents !== 0 ||
    !tableLabels ||
    !items ||
    !discounts ||
    !payments ||
    !refunds
  ) {
    return null;
  }
  return {
    businessName,
    cashierRequest: request,
    closedAt,
    currency: "ARS",
    discounts,
    invoiceNotice: RECEIPT_INVOICE_NOTICE,
    items,
    locationName,
    notice: RECEIPT_NOTICE,
    number,
    openedAt,
    payments,
    refunds,
    sessionId,
    summary,
    tableLabels
  };
}

function closedTable(input: unknown): ClosedTable | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["label", "state", "tableId"])) return null;
  const label = text(root.label, 80);
  const tableId = uuid(root.tableId);
  return label && tableId && root.state === "needs_cleaning"
    ? { label, state: "needs_cleaning", tableId }
    : null;
}

export function parseCloseAccountResult(
  input: unknown
): CloseAccountResult | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, ["closedAt", "receipt", "sessionId", "tables"])
  ) {
    return null;
  }
  const closedAt = timestamp(root.closedAt);
  const receipt = parseAccountReceipt(root.receipt);
  const sessionId = uuid(root.sessionId);
  const tables = list(root.tables, closedTable);
  return closedAt && receipt && sessionId && tables && tables.length > 0
    ? { closedAt, receipt, sessionId, tables }
    : null;
}

export function parseCleanTableResult(input: unknown): CleanTableResult | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["state", "tableId"])) return null;
  const tableId = uuid(root.tableId);
  return tableId && root.state === "available"
    ? { state: "available", tableId }
    : null;
}

export function parseCashierRequestResult(
  input: unknown
): CashierRequestResult | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, ["receiptNumber", "requestId", "sessionId", "status"]) ||
    root.status !== "open"
  ) {
    return null;
  }
  const receiptNumber = integer(root.receiptNumber);
  const requestId = uuid(root.requestId);
  const sessionId = uuid(root.sessionId);
  return receiptNumber !== null && receiptNumber > 0 && requestId && sessionId
    ? { receiptNumber, requestId, sessionId, status: "open" }
    : null;
}

export function parseResolveCashierRequestResult(
  input: unknown
): ResolveCashierRequestResult | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, ["requestId", "status"]) ||
    root.status !== "resolved"
  ) {
    return null;
  }
  const requestId = uuid(root.requestId);
  return requestId ? { requestId, status: "resolved" } : null;
}

function closedAccount(input: unknown): ClosedAccount | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, [
      "cashierRequest",
      "closedAt",
      "receiptNumber",
      "sessionId",
      "tableLabels",
      "totalCents"
    ])
  ) {
    return null;
  }
  const request =
    root.cashierRequest === null ? null : cashierRequest(root.cashierRequest);
  if (root.cashierRequest !== null && request === null) return null;
  const closedAt = timestamp(root.closedAt);
  const receiptNumber = integer(root.receiptNumber);
  const sessionId = uuid(root.sessionId);
  const tableLabels = labels(root.tableLabels);
  const totalCents = integer(root.totalCents);
  return closedAt &&
    receiptNumber !== null &&
    receiptNumber > 0 &&
    sessionId &&
    tableLabels &&
    totalCents !== null
    ? {
        cashierRequest: request,
        closedAt,
        receiptNumber,
        sessionId,
        tableLabels,
        totalCents
      }
    : null;
}

export function parseClosedAccountsView(
  input: unknown
): ClosedAccountsView | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["accounts", "generatedAt"])) return null;
  const accounts = list(root.accounts, closedAccount);
  const generatedAt = timestamp(root.generatedAt);
  return accounts && generatedAt ? { accounts, generatedAt } : null;
}
