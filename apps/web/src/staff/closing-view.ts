import type {
  AccountReceipt,
  AccountSummary,
  CashierRequestState,
  ClosedAccount
} from "@platform/contracts";

import { formatMoney } from "../app/m/[token]/diner-catalog-format";
import { paymentMethodName } from "./account-view";

/** Why an account cannot be closed yet, or null when its balance is exactly zero. */
export function closeBlockedReason(summary: AccountSummary): string | null {
  if (summary.pendingCents > 0) {
    return "Todavía hay saldo: cobralo o ajustalo antes de cerrar la cuenta.";
  }
  if (summary.pendingCents < 0) {
    return "Hay saldo a favor del comensal: devolvelo antes de cerrar la cuenta.";
  }
  return null;
}

export function closedAccountLabel(
  account: Pick<ClosedAccount, "receiptNumber" | "tableLabels">
): string {
  const tables =
    account.tableLabels.length === 1
      ? `Mesa ${account.tableLabels[0]}`
      : `Mesas ${account.tableLabels.join(" + ")}`;
  return `${tables} · Comprobante N° ${account.receiptNumber}`;
}

export function cashierRequestLabel(
  request: CashierRequestState | null
): string | null {
  if (!request) return null;
  return request.status === "open" ? "Caja avisada" : "Caja atendió el aviso";
}

export type ReceiptLine = { label: string; value: string };

/** The amounts of a receipt in reading order; the discount and every method on its own line. */
export function receiptLines(
  receipt: Pick<
    AccountReceipt,
    "discounts" | "payments" | "refunds" | "summary"
  >
): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { label: "Consumo", value: formatMoney(receipt.summary.consumedCents) }
  ];
  for (const discount of receipt.discounts) {
    lines.push({
      label: `Descuento · ${discount.cause}`,
      value: `−${formatMoney(discount.amountCents)}`
    });
  }
  if (receipt.summary.tipCents > 0) {
    lines.push({
      label: "Propina",
      value: formatMoney(receipt.summary.tipCents)
    });
  }
  for (const payment of receipt.payments) {
    lines.push({
      label: `Cobrado · ${payment.method ? paymentMethodName(payment.method) : "Sin medio"}`,
      value: formatMoney(payment.amountCents)
    });
  }
  for (const refund of receipt.refunds) {
    lines.push({
      label: `Devuelto · ${refund.method ? paymentMethodName(refund.method) : "Sin medio"}`,
      value: formatMoney(refund.amountCents)
    });
  }
  lines.push({
    label: "Saldo",
    value: formatMoney(receipt.summary.pendingCents)
  });
  return lines;
}
