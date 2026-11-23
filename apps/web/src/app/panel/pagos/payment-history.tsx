"use client";

import {
  paymentMethodLabels,
  type PaymentHistoryAccount
} from "@platform/contracts";
import { useState } from "react";

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS"
});
const date = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires"
});

function accountState(account: PaymentHistoryAccount) {
  if (account.status === "closed") return "Cerrada";
  if (account.pendingCents > 0)
    return account.paidCents > 0 ? "Pago parcial" : "Pendiente";
  return account.paidCents > 0 ? "Pagada, abierta" : "Abierta sin saldo";
}

export function PaymentHistory({
  accounts
}: {
  accounts: PaymentHistoryAccount[] | null;
}) {
  const [table, setTable] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const visible = accounts?.filter(
    (account) =>
      account.tableLabels.some((label) =>
        label.toLowerCase().includes(table.trim().toLowerCase())
      ) &&
      (!status || accountState(account) === status) &&
      (!method ||
        account.movements.some((movement) => movement.method === method))
  );

  return (
    <section
      className="panel-content payments-workspace payment-history"
      aria-labelledby="payment-history-title"
    >
      <div className="payment-card__summary">
        <h1 id="payment-history-title">Cobros y cierres de mesa</h1>
        <a className="button button--secondary" href="#payments-title">
          Configurar medios de pago
        </a>
      </div>
      {accounts === null ? (
        <p role="alert">
          No pudimos cargar el historial. Actualizá la página para reintentar.
        </p>
      ) : (
        <>
          <p className="panel-lead">
            Hasta 100 cuentas, ordenadas por su última actividad. Se priorizan
            las abiertas.
          </p>
          <div className="payment-history__filters">
            <label className="field-group">
              Mesa
              <input
                value={table}
                onChange={(event) => setTable(event.target.value)}
                placeholder="Ej. 5"
              />
            </label>
            <label className="field-group">
              Estado
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">Todos</option>
                {[
                  "Pendiente",
                  "Pago parcial",
                  "Pagada, abierta",
                  "Abierta sin saldo",
                  "Cerrada"
                ].map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </label>
            <label className="field-group">
              Medio de pago
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(paymentMethodLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="payment-list">
            {visible?.map((account) => (
              <li className="payment-card" key={account.id}>
                <details>
                  <summary>
                    <strong>
                      {account.tableLabels.length > 1 ? "Mesas" : "Mesa"}{" "}
                      {account.tableLabels.join(", ")}
                    </strong>{" "}
                    <span className="status-pill">{accountState(account)}</span>
                    <span className="payment-history__amounts">
                      <span>
                        Cobrado {money.format(account.paidCents / 100)}
                      </span>
                      <span>
                        Pendiente {money.format(account.pendingCents / 100)}
                      </span>
                      <time dateTime={account.lastAt}>
                        {date.format(new Date(account.lastAt))}
                      </time>
                    </span>
                  </summary>
                  {account.closedAt ? (
                    <p>Cierre {date.format(new Date(account.closedAt))}</p>
                  ) : null}
                  {account.movements.length === 0 ? (
                    <p>Sin cobros registrados.</p>
                  ) : (
                    <ul className="payment-list">
                      {account.movements.map((movement) => (
                        <li key={movement.id}>
                          <strong>
                            {movement.kind === "refund"
                              ? "Devolución"
                              : "Cobro"}{" "}
                            {money.format(movement.amountCents / 100)}
                          </strong>
                          {" · "}
                          {movement.method
                            ? paymentMethodLabels[movement.method]
                            : "Medio sin registrar"}
                          {" · "}
                          <time dateTime={movement.at}>
                            {date.format(new Date(movement.at))}
                          </time>
                          <div>
                            Pagó{" "}
                            {movement.payers.join(", ") ||
                              "sin nombre registrado"}
                          </div>
                          {movement.recordedBy ? (
                            <div>Registró {movement.recordedBy}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ul>
          {visible?.length === 0 ? (
            <p>No hay cuentas para estos filtros.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
