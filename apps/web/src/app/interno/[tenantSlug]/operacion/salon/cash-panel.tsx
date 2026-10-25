"use client";

import type {
  CashMovementKind,
  CashRegisterView,
  CloseShiftResult
} from "@platform/contracts";
import { useState } from "react";

import { parseMoneyInput } from "../../../../../staff/account-view";
import {
  breakdownLines,
  cashDifferenceLabel,
  cashMovementLabel,
  closureSummary
} from "../../../../../staff/cash-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

export type CashPanelProps = {
  busy: string | null;
  /** Open accounts still owing, so closing shows what stays pending. */
  owingAccounts: number;
  /** Counted cash, and the reason once a difference was shown. */
  onClose(
    countedCashCents: number,
    reason: string | null
  ): Promise<CloseShiftResult | null>;
  onMovement(kind: CashMovementKind, amountCents: number, reason: string): void;
  onOpen(openingCashCents: number): void;
  view: CashRegisterView;
};

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function ClosedSummary({
  result
}: {
  result: CloseShiftResult & { closed: true };
}) {
  return (
    <section aria-label="Caja cerrada" className="waiter-card cash-closed">
      <h3>Caja cerrada</h3>
      <p className="account-balance">
        {cashDifferenceLabel(result.differenceCents)}
      </p>
      <dl className="account-summary">
        <div>
          <dt>Efectivo esperado</dt>
          <dd>{formatMoney(result.expectedCashCents)}</dd>
        </div>
        <div>
          <dt>Efectivo contado</dt>
          <dd>{formatMoney(result.countedCashCents)}</dd>
        </div>
        {breakdownLines(result.breakdown).map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.net}</dd>
          </div>
        ))}
      </dl>
      {result.reason ? (
        <p className="waiter-note">Motivo: {result.reason}</p>
      ) : null}
      {result.pendingAccounts > 0 ? (
        <p className="waiter-note">
          Quedan {result.pendingAccounts} cuenta
          {result.pendingAccounts === 1 ? "" : "s"} con{" "}
          {formatMoney(result.pendingCents)} pendiente
          {result.pendingAccounts === 1 ? "" : "s"}: se cobran en el próximo
          turno de caja.
        </p>
      ) : null}
    </section>
  );
}

export function CashPanel({
  busy,
  onClose,
  onMovement,
  onOpen,
  owingAccounts,
  view
}: CashPanelProps) {
  const [opening, setOpening] = useState("");
  const [kind, setKind] = useState<CashMovementKind>("cash_out");
  const [amount, setAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [counted, setCounted] = useState("");
  const [difference, setDifference] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [closed, setClosed] = useState<
    (CloseShiftResult & { closed: true }) | null
  >(null);

  const openingCents = opening.trim() === "" ? 0 : parseMoneyInput(opening);
  const movementCents = parseMoneyInput(amount);
  const countedCents = parseMoneyInput(counted);
  const { register } = view;

  async function submitClose() {
    if (countedCents === null) return;
    const justification = difference === null ? null : reason.trim();
    const result = await onClose(countedCents, justification);
    if (!result) return;
    if (result.closed) {
      setClosed(result);
      setDifference(null);
      setCounted("");
      setReason("");
    } else {
      setDifference(result.differenceCents);
    }
  }

  return (
    <section aria-labelledby="cash-title" className="waiter-section">
      <h2 id="cash-title">Caja</h2>
      {!view.canManage ? (
        <p className="waiter-note">
          {register.open
            ? "La caja está abierta."
            : "La caja está cerrada: el Encargado tiene que abrirla."}
        </p>
      ) : null}

      {closed ? <ClosedSummary result={closed} /> : null}

      {view.canManage && !register.open ? (
        <form
          className="waiter-card account-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (openingCents === null) return;
            setClosed(null);
            onOpen(openingCents);
          }}
        >
          <h3>Abrir caja</h3>
          <label htmlFor="cash-opening">
            Efectivo inicial en el cajón (fondo)
          </label>
          <input
            id="cash-opening"
            inputMode="decimal"
            onChange={(event) => setOpening(event.target.value)}
            placeholder="0"
            value={opening}
          />
          <p className="waiter-note">
            Hasta que no abras la caja nadie puede registrar cobros.
          </p>
          <button
            className="button button--primary"
            disabled={busy !== null || openingCents === null}
            type="submit"
          >
            Abrir caja
          </button>
        </form>
      ) : null}

      {register.open ? (
        <>
          <article className="waiter-card" data-testid="cash-open">
            <header>
              <h3>Caja abierta</h3>
              <p className="account-balance">
                Desde las {time(register.openedAt)} · {register.openedByName}
              </p>
            </header>
            <dl className="account-summary">
              <div>
                <dt>Fondo inicial</dt>
                <dd>{formatMoney(register.openingCashCents)}</dd>
              </div>
              <div>
                <dt>Cobros</dt>
                <dd>{register.paymentCount}</dd>
              </div>
              <div>
                <dt>Devoluciones</dt>
                <dd>{register.refundCount}</dd>
              </div>
            </dl>
            {register.movements.length > 0 ? (
              <ul className="waiter-lines">
                {register.movements.map((movement) => (
                  <li key={movement.id}>
                    <span>
                      {cashMovementLabel(movement.kind)} · {movement.reason}
                    </span>
                    <b>
                      {movement.kind === "cash_in" ? "+" : "−"}
                      {formatMoney(movement.amountCents)}
                    </b>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>

          {view.canManage ? (
            <>
              <form
                className="waiter-card account-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (movementCents === null || movementCents <= 0) return;
                  if (movementReason.trim() === "") return;
                  onMovement(kind, movementCents, movementReason.trim());
                  setAmount("");
                  setMovementReason("");
                }}
              >
                <h3>Ingreso o retiro de efectivo</h3>
                <label htmlFor="cash-kind">Movimiento</label>
                <select
                  id="cash-kind"
                  onChange={(event) =>
                    setKind(event.target.value as CashMovementKind)
                  }
                  value={kind}
                >
                  <option value="cash_out">Retiro de efectivo</option>
                  <option value="cash_in">Ingreso de efectivo</option>
                </select>
                <label htmlFor="cash-amount">Monto</label>
                <input
                  id="cash-amount"
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  value={amount}
                />
                <label htmlFor="cash-movement-reason">
                  Motivo (obligatorio)
                </label>
                <input
                  id="cash-movement-reason"
                  maxLength={200}
                  onChange={(event) => setMovementReason(event.target.value)}
                  value={movementReason}
                />
                <button
                  className="button button--secondary"
                  disabled={
                    busy !== null ||
                    movementCents === null ||
                    movementCents <= 0 ||
                    movementReason.trim() === ""
                  }
                  type="submit"
                >
                  Registrar movimiento
                </button>
              </form>

              <form
                className="waiter-card account-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitClose();
                }}
              >
                <h3>Cerrar caja</h3>
                <p className="waiter-note">
                  Contá el efectivo del cajón sin mirar el sistema: la
                  diferencia aparece recién después de contar.
                  {owingAccounts > 0
                    ? ` Hay ${owingAccounts} cuenta${owingAccounts === 1 ? "" : "s"} con saldo pendiente que no se cierra${owingAccounts === 1 ? "" : "n"} con la caja.`
                    : ""}
                </p>
                <label htmlFor="cash-counted">Efectivo contado</label>
                <input
                  id="cash-counted"
                  inputMode="decimal"
                  onChange={(event) => {
                    setCounted(event.target.value);
                    setDifference(null);
                  }}
                  value={counted}
                />
                {difference !== null ? (
                  <div role="alert">
                    <p className="account-balance">
                      {cashDifferenceLabel(difference)}
                    </p>
                    <label htmlFor="cash-close-reason">
                      Justificá la diferencia (obligatorio)
                    </label>
                    <textarea
                      id="cash-close-reason"
                      maxLength={200}
                      onChange={(event) => setReason(event.target.value)}
                      rows={2}
                      value={reason}
                    />
                  </div>
                ) : null}
                <button
                  className="button button--primary"
                  disabled={
                    busy !== null ||
                    countedCents === null ||
                    (difference !== null && reason.trim() === "")
                  }
                  type="submit"
                >
                  {difference === null
                    ? "Contar y cerrar"
                    : "Cerrar con diferencia"}
                </button>
              </form>
            </>
          ) : null}
        </>
      ) : null}

      {view.closures.length > 0 ? (
        <details className="account-movements">
          <summary>Cierres anteriores ({view.closures.length})</summary>
          <ul className="waiter-lines">
            {view.closures.map((closure) => (
              <li key={closure.shiftId}>
                <span>
                  {time(closure.openedAt)}–{time(closure.closedAt)} ·{" "}
                  {closure.closedByName} · {closureSummary(closure)}
                  {closure.reason ? ` · ${closure.reason}` : ""}
                </span>
                <b>{formatMoney(closure.countedCashCents)}</b>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
