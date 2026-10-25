import type {
  AccountEntryPaymentMethod,
  AccountMovementKind,
  AccountPaymentMethod,
  AccountSummary,
  WaiterAccount
} from "@platform/contracts";

import { formatMoney } from "../app/m/[token]/diner-catalog-format";

/** Pending balance in words: what is owed, settled, or owed back. */
export function accountBalanceLabel(summary: AccountSummary): string {
  if (summary.pendingCents > 0) {
    return `Pendiente ${formatMoney(summary.pendingCents)}`;
  }
  if (summary.pendingCents < 0) {
    return `A favor del comensal ${formatMoney(-summary.pendingCents)}`;
  }
  return "Cuenta saldada";
}

const movementLabels: Record<AccountMovementKind, string> = {
  adjustment: "Ajuste",
  charge: "Consumo",
  discount: "Descuento",
  payment: "Cobro",
  refund: "Devolución",
  tip: "Propina"
};

export function movementLabel(kind: AccountMovementKind): string {
  return movementLabels[kind];
}

/** In-person only; a physical card never asks for its number here. */
export const paymentMethodChoices: readonly {
  label: string;
  value: AccountPaymentMethod;
}[] = [
  { label: "Efectivo", value: "cash" },
  { label: "Tarjeta de crédito", value: "credit_card" },
  { label: "Tarjeta de débito", value: "debit_card" },
  { label: "Otro medio presencial", value: "other_in_person" }
];

export function paymentMethodName(method: AccountEntryPaymentMethod): string {
  if (method === "mercado_pago") return "Mercado Pago";
  return (
    paymentMethodChoices.find((choice) => choice.value === method)?.label ??
    method
  );
}

/**
 * Typed pesos to cents with integer arithmetic: "1.234,56", "150,5" or "150.5".
 * More than two decimals, signs and letters are refused instead of rounded.
 */
export function parseMoneyInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/u.exec(trimmed);
  if (!match) return null;
  const pesos = Number((match[1] ?? "").replaceAll(".", ""));
  const decimals = (match[2] ?? "").padEnd(2, "0");
  const cents = pesos * 100 + Number(decimals);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function percentLabel(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : String(percent).replace(".", ",")} %`;
}

export function accountForTable(
  accounts: readonly WaiterAccount[],
  tableLabel: string
): WaiterAccount | undefined {
  return accounts.find((account) => account.tableLabels.includes(tableLabel));
}
