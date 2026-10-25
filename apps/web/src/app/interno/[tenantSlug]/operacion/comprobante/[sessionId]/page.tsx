import { isWaiterUuid, parseAccountReceipt } from "@platform/contracts";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { receiptLines } from "../../../../../../staff/closing-view";
import { loadStaffSession } from "../../../../../../staff/load-staff-session";
import { callStaffApi } from "../../../../../../staff/waiter-api";
import { formatMoney } from "../../../../../m/[token]/diner-catalog-format";
import { PrintReceiptButton } from "./print-receipt-button";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Comprobante de consumo"
};

function stamp(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

/**
 * Non-fiscal receipt of a closed account. It reads the receipt issued at close,
 * so reopening the page (or printing it to PDF) always shows the same figures.
 */
export default async function ReceiptPage({
  params
}: {
  params: Promise<{ sessionId: string; tenantSlug: string }>;
}) {
  const { sessionId, tenantSlug } = await params;
  const session = await loadStaffSession(tenantSlug);
  if (!session.identity.staff.capabilities.includes("tables.serve")) {
    redirect(`/interno/${tenantSlug}/operacion`);
  }
  if (!isWaiterUuid(sessionId)) notFound();

  const response = await callStaffApi(
    tenantSlug,
    "GET",
    `/v1/staff/accounts/${sessionId}/receipt`
  ).catch(() => null);
  if (!response || "sessionMissing" in response) {
    redirect(`/interno/${tenantSlug}`);
  }
  if (response.status === 401) redirect(`/interno/${tenantSlug}`);
  const receipt = response.ok
    ? parseAccountReceipt((response.body as { data?: unknown } | null)?.data)
    : null;
  if (!receipt) notFound();

  return (
    <main className="receipt-page">
      <article aria-labelledby="receipt-title" className="receipt">
        <header>
          <p className="eyebrow">{receipt.businessName}</p>
          <h1 id="receipt-title">{receipt.notice}</h1>
          <p>
            {receipt.locationName} ·{" "}
            {receipt.tableLabels.length === 1
              ? `Mesa ${receipt.tableLabels[0]}`
              : `Mesas ${receipt.tableLabels.join(" + ")}`}{" "}
            · Comprobante N° {receipt.number}
          </p>
          <p>
            Abierta {stamp(receipt.openedAt)} · Cerrada{" "}
            {stamp(receipt.closedAt)}
          </p>
        </header>

        <ul aria-label="Consumos" className="receipt__items">
          {receipt.items.map((item) => (
            <li key={item.lineId}>
              <span>
                {item.quantity} × {item.title}
              </span>
              <b>{formatMoney(item.totalCents)}</b>
            </li>
          ))}
        </ul>

        <dl aria-label="Importes" className="receipt__totals">
          {receiptLines(receipt).map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>

        <p className="receipt__invoice">{receipt.invoiceNotice}</p>
      </article>
      <div className="receipt-actions">
        <PrintReceiptButton />
        <a
          className="button button--secondary"
          href={`/interno/${tenantSlug}/operacion/salon?vista=cuentas`}
        >
          Volver a Cuentas
        </a>
      </div>
    </main>
  );
}
