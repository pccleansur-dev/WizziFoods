import type {
  CashMovementKind,
  CashShiftClosure,
  ShiftBreakdown,
  WaiterAccount
} from "@platform/contracts";

import { formatMoney } from "../app/m/[token]/diner-catalog-format";
import { paymentMethodName } from "./account-view";

const movementKindLabels: Record<CashMovementKind, string> = {
  cash_in: "Ingreso de efectivo",
  cash_out: "Retiro de efectivo"
};

export function cashMovementLabel(kind: CashMovementKind): string {
  return movementKindLabels[kind];
}

/** Difference of a count in words; the sign says whether cash is missing or left over. */
export function cashDifferenceLabel(differenceCents: number): string {
  if (differenceCents === 0) return "Sin diferencia";
  return differenceCents < 0
    ? `Faltan ${formatMoney(-differenceCents)}`
    : `Sobran ${formatMoney(differenceCents)}`;
}

/** What was received and given back per payment method, in a fixed order. */
export function breakdownLines(
  breakdown: ShiftBreakdown
): { label: string; net: string }[] {
  const order = [
    "cash",
    "credit_card",
    "debit_card",
    "other_in_person"
  ] as const;
  const lines: { label: string; net: string }[] = [];
  for (const method of order) {
    const row = breakdown.methods[method];
    if (!row) continue;
    const refunded =
      row.refundedCents > 0
        ? ` (devuelto ${formatMoney(row.refundedCents)})`
        : "";
    lines.push({
      label: paymentMethodName(method),
      net: `${formatMoney(row.receivedCents)}${refunded}`
    });
  }
  return lines;
}

export function closureSummary(closure: CashShiftClosure): string {
  const pending =
    closure.pendingAccounts > 0
      ? ` · ${closure.pendingAccounts} cuenta${closure.pendingAccounts === 1 ? "" : "s"} con ${formatMoney(closure.pendingCents)} pendiente${closure.pendingAccounts === 1 ? "" : "s"}`
      : "";
  return `${cashDifferenceLabel(closure.differenceCents)}${pending}`;
}

export type RefundablePayment = {
  amountCents: number;
  label: string;
  paymentId: string;
};

/** Payments of the account a manager can refund against (the ledger's payment rows). */
export function refundablePayments(
  account: WaiterAccount
): RefundablePayment[] {
  return account.entries
    .filter(
      (entry) =>
        entry.kind === "payment" &&
        entry.paymentMethod !== null &&
        entry.paymentMethod !== "mercado_pago"
    )
    .map((entry) => ({
      amountCents: -entry.amountCents,
      label: `${entry.paymentMethod ? paymentMethodName(entry.paymentMethod) : ""} · ${formatMoney(-entry.amountCents)}`,
      paymentId: entry.sourceId
    }));
}

export function onlineRefundablePayments(
  account: WaiterAccount
): RefundablePayment[] {
  return account.entries
    .filter(
      (entry) =>
        entry.kind === "payment" && entry.paymentMethod === "mercado_pago"
    )
    .map((entry) => ({
      amountCents: -entry.amountCents,
      label: `${entry.paymentMethod ? paymentMethodName(entry.paymentMethod) : ""} · ${formatMoney(-entry.amountCents)}`,
      paymentId: entry.sourceId
    }));
}
