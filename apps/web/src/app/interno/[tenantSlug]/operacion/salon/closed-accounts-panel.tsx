"use client";

import type { ClosedAccount } from "@platform/contracts";

import {
  cashierRequestLabel,
  closedAccountLabel
} from "../../../../../staff/closing-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

export type ClosedAccountsPanelProps = {
  accounts: ClosedAccount[];
  busy: string | null;
  isManager: boolean;
  onNotifyCashier(sessionId: string): void;
  onResolveRequest(requestId: string): void;
  tenantSlug: string;
};

function closedAt(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

/** Accounts closed in the last hours: their receipt and the invoice notice for the cashier. */
export function ClosedAccountsPanel({
  accounts,
  busy,
  isManager,
  onNotifyCashier,
  onResolveRequest,
  tenantSlug
}: ClosedAccountsPanelProps) {
  return (
    <section
      aria-labelledby="closed-accounts-title"
      className="waiter-section closed-accounts"
    >
      <h2 id="closed-accounts-title">Cuentas cerradas</h2>
      {accounts.length === 0 ? (
        <p className="waiter-empty">Todavía no cerraste ninguna cuenta.</p>
      ) : (
        <ul className="waiter-lines closed-accounts__list">
          {accounts.map((account) => {
            const request = account.cashierRequest;
            const requested = request?.status === "open";
            const label = closedAccountLabel(account);
            return (
              <li className="closed-account" key={account.sessionId}>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {" "}
                    · {formatMoney(account.totalCents)} · cerrada{" "}
                    {closedAt(account.closedAt)}
                  </small>
                  {request ? (
                    <small className="waiter-chip waiter-chip--claimed">
                      {cashierRequestLabel(request)}
                    </small>
                  ) : null}
                </div>
                <div className="waiter-actions">
                  <a
                    aria-label={`Ver comprobante: ${label}`}
                    className="button button--secondary"
                    href={`/interno/${tenantSlug}/operacion/comprobante/${account.sessionId}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Comprobante
                  </a>
                  <button
                    aria-label={`Avisar a caja: ${label}`}
                    className="button button--secondary"
                    disabled={busy !== null || requested}
                    onClick={() => onNotifyCashier(account.sessionId)}
                    type="button"
                  >
                    Avisar a caja
                  </button>
                  {isManager && request && requested ? (
                    <button
                      aria-label={`Marcar atendido el aviso a caja: ${label}`}
                      className="button button--secondary"
                      disabled={busy !== null}
                      onClick={() => onResolveRequest(request.requestId)}
                      type="button"
                    >
                      Aviso atendido
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
