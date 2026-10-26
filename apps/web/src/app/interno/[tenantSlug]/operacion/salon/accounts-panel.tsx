"use client";

import type { AccountPaymentMethod, WaiterAccount } from "@platform/contracts";
import { useState } from "react";

import {
  accountBalanceLabel,
  movementLabel,
  parseMoneyInput,
  paymentMethodChoices,
  paymentMethodName
} from "../../../../../staff/account-view";
import {
  onlineRefundablePayments,
  refundablePayments
} from "../../../../../staff/cash-view";
import { closeBlockedReason } from "../../../../../staff/closing-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";
import { LoyaltyRewards } from "./loyalty-rewards";

export type PaymentDraft = {
  amountCents: number | null;
  method: AccountPaymentMethod;
  tipCents: number;
};
export type DiscountDraft = {
  kind: "amount" | "percent";
  reason: string;
  value: number;
};

export type RefundDraft = {
  amountCents: number;
  paymentId: string;
  reason: string;
};

export type SharesDraft = {
  method: AccountPaymentMethod;
  payerLabel: string | null;
  positions: number[];
  splitId: string;
  tipCents: number;
};

export type AccountsPanelProps = {
  accounts: WaiterAccount[];
  busy: string | null;
  /** Collecting needs an open register; the manager opens it from Caja. */
  cashOpen: boolean;
  /** Opens the collection form of this account when the panel mounts. */
  collectSessionId: string | null;
  isManager: boolean;
  /** Closes a settled account: the table then waits for cleaning. */
  onClose(sessionId: string): void;
  onDiscount(sessionId: string, draft: DiscountDraft): void;
  onKeepOpen(sessionId: string): void;
  onOnlineRefund(sessionId: string, draft: RefundDraft): void;
  onPay(sessionId: string, draft: PaymentDraft): void;
  onPayShares(sessionId: string, draft: SharesDraft): void;
  onRefund(sessionId: string, draft: RefundDraft): void;
  onItemSplit(
    sessionId: string,
    persons: number,
    assignments: { lineId: string; position: number }[]
  ): void;
  onSplit(sessionId: string, parts: number): void;
};

type Panel =
  "collect" | "discount" | "online-refund" | "refund" | "split" | null;

function signed(cents: number): string {
  return `${cents < 0 ? "−" : "+"}${formatMoney(Math.abs(cents))}`;
}

function AccountCard({
  account,
  busy,
  cashOpen,
  collectSessionId,
  isManager,
  onClose,
  onDiscount,
  onKeepOpen,
  onOnlineRefund,
  onPay,
  onPayShares,
  onRefund,
  onItemSplit,
  onSplit
}: Omit<AccountsPanelProps, "accounts"> & { account: WaiterAccount }) {
  const [panel, setPanel] = useState<Panel>(
    collectSessionId === account.sessionId
      ? "collect"
      : account.split
        ? "split"
        : null
  );
  const [method, setMethod] = useState<AccountPaymentMethod>("cash");
  const [amount, setAmount] = useState("");
  const [tip, setTip] = useState("");
  const [kind, setKind] = useState<"amount" | "percent">("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [parts, setParts] = useState("3");
  const [persons, setPersons] = useState("2");
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<number[]>([]);
  const [shareMethod, setShareMethod] = useState<AccountPaymentMethod>("cash");
  const [payer, setPayer] = useState("");
  const [refundPayment, setRefundPayment] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [onlinePayment, setOnlinePayment] = useState("");
  const [onlineAmount, setOnlineAmount] = useState("");
  const [onlineReason, setOnlineReason] = useState("");
  const { summary } = account;
  const payments = refundablePayments(account);
  const split = account.split;
  const openShares =
    split?.shares.filter(
      (share) => share.status === "open" || share.status === "claimed"
    ) ?? [];
  const pickedShares = openShares.filter((share) =>
    picked.includes(share.position)
  );
  const pickedTotal = pickedShares.reduce(
    (sum, share) => sum + share.amountCents,
    0
  );
  const partsNumber = Number(parts);
  const personsNumber = Number(persons);
  const personsValid =
    Number.isInteger(personsNumber) &&
    personsNumber >= 2 &&
    personsNumber <= 20 &&
    account.liveItems.length > 0;
  const partsValid =
    Number.isInteger(partsNumber) &&
    partsNumber >= 2 &&
    partsNumber <= 20 &&
    summary.pendingCents >= partsNumber;
  const onlinePayments = onlineRefundablePayments(account);
  const refundCents = parseMoneyInput(refundAmount);
  const refundValid =
    refundCents !== null &&
    refundCents > 0 &&
    refundReason.trim().length > 0 &&
    payments.some((payment) => payment.paymentId === refundPayment);
  const onlineCents = parseMoneyInput(onlineAmount);
  const onlineValid =
    onlineCents !== null &&
    onlineCents > 0 &&
    onlineReason.trim().length > 0 &&
    onlinePayments.some((payment) => payment.paymentId === onlinePayment);
  const tables = account.tableLabels.join(" + ");
  const titleId = `account-${account.sessionId}`;
  const owes = summary.pendingCents > 0;

  const typedAmount = amount.trim() === "" ? null : parseMoneyInput(amount);
  const typedTip = tip.trim() === "" ? 0 : parseMoneyInput(tip);
  const amountValid =
    (amount.trim() === "" || (typedAmount !== null && typedAmount > 0)) &&
    typedTip !== null;
  const typedValue = parseMoneyInput(value);
  const discountValid =
    typedValue !== null &&
    typedValue > 0 &&
    (kind === "amount" || typedValue <= 10_000) &&
    reason.trim().length > 0;
  const toCollect = typedAmount ?? summary.pendingCents;
  const blockedClose = closeBlockedReason(summary);

  return (
    <article
      aria-labelledby={titleId}
      className="waiter-card account-card"
      data-pending={summary.pendingCents}
    >
      <header>
        <h3 id={titleId}>Mesa {tables}</h3>
        <p className="account-balance">{accountBalanceLabel(summary)}</p>
        {account.keptOpen ? (
          <p className="waiter-chip waiter-chip--claimed">Cuenta abierta</p>
        ) : null}
      </header>
      <dl className="account-summary">
        <div>
          <dt>Consumido</dt>
          <dd>{formatMoney(summary.consumedCents)}</dd>
        </div>
        {summary.discountCents > 0 ? (
          <div>
            <dt>Descuentos</dt>
            <dd>−{formatMoney(summary.discountCents)}</dd>
          </div>
        ) : null}
        {summary.tipCents > 0 ? (
          <div>
            <dt>Propinas</dt>
            <dd>{formatMoney(summary.tipCents)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Cobrado</dt>
          <dd>{formatMoney(summary.paidCents)}</dd>
        </div>
      </dl>

      <details className="account-movements">
        <summary>Movimientos ({account.entries.length})</summary>
        <ul className="waiter-lines">
          {account.entries.map((entry) => (
            <li key={entry.id}>
              <span>
                {movementLabel(entry.kind)} · {entry.cause}
                {entry.paymentMethod
                  ? ` · ${paymentMethodName(entry.paymentMethod)}`
                  : ""}
              </span>
              <b>{signed(entry.amountCents)}</b>
            </li>
          ))}
        </ul>
      </details>

      <div className="waiter-actions">
        {owes ? (
          <button
            aria-expanded={panel === "collect"}
            aria-label={`Cobrar ahora: mesa ${tables}`}
            className="button button--primary"
            disabled={busy !== null || !cashOpen}
            onClick={() => setPanel(panel === "collect" ? null : "collect")}
            type="button"
          >
            Cobrar ahora
          </button>
        ) : null}
        <button
          aria-label={`Dejar cuenta abierta: mesa ${tables}`}
          className="button button--secondary"
          disabled={busy !== null || account.keptOpen}
          onClick={() => onKeepOpen(account.sessionId)}
          type="button"
        >
          Dejar cuenta abierta
        </button>
        {blockedClose === null ? (
          <button
            aria-label={`Cerrar cuenta: mesa ${tables}`}
            className="button button--primary"
            disabled={busy !== null}
            onClick={() => onClose(account.sessionId)}
            type="button"
          >
            Cerrar cuenta
          </button>
        ) : null}
        {isManager && owes ? (
          <button
            aria-expanded={panel === "discount"}
            aria-label={`Aplicar descuento: mesa ${tables}`}
            className="button button--secondary"
            disabled={busy !== null}
            onClick={() => setPanel(panel === "discount" ? null : "discount")}
            type="button"
          >
            Descuento…
          </button>
        ) : null}
        {owes ? (
          <button
            aria-expanded={panel === "split"}
            aria-label={`Dividir la cuenta: mesa ${tables}`}
            className="button button--secondary"
            disabled={busy !== null || !cashOpen}
            onClick={() => setPanel(panel === "split" ? null : "split")}
            type="button"
          >
            {split ? "Partes…" : "Dividir…"}
          </button>
        ) : null}
        {isManager && payments.length > 0 ? (
          <button
            aria-expanded={panel === "refund"}
            aria-label={`Devolver dinero: mesa ${tables}`}
            className="button button--secondary"
            disabled={busy !== null || !cashOpen}
            onClick={() => setPanel(panel === "refund" ? null : "refund")}
            type="button"
          >
            Devolver…
          </button>
        ) : null}
        {isManager && onlinePayments.length > 0 ? (
          <button
            aria-expanded={panel === "online-refund"}
            aria-label={`Devolver por Mercado Pago: mesa ${tables}`}
            className="button button--secondary"
            disabled={busy !== null}
            onClick={() =>
              setPanel(panel === "online-refund" ? null : "online-refund")
            }
            type="button"
          >
            Devolver por Mercado Pago…
          </button>
        ) : null}
      </div>

      {blockedClose !== null && summary.pendingCents < 0 ? (
        <p className="waiter-note">{blockedClose}</p>
      ) : null}

      {panel === "collect" && owes && cashOpen ? (
        <LoyaltyRewards
          busy={busy !== null}
          onSettled={() => setPanel(null)}
          sessionId={account.sessionId}
        />
      ) : null}

      {panel === "collect" && owes && cashOpen ? (
        <form
          className="waiter-reject account-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!amountValid || typedTip === null) return;
            onPay(account.sessionId, {
              amountCents: typedAmount,
              method,
              tipCents: typedTip
            });
          }}
        >
          <label htmlFor={`method-${account.sessionId}`}>Medio de pago</label>
          <select
            id={`method-${account.sessionId}`}
            onChange={(event) =>
              setMethod(event.target.value as AccountPaymentMethod)
            }
            value={method}
          >
            {paymentMethodChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <label htmlFor={`amount-${account.sessionId}`}>
            Monto a cobrar (vacío: todo el saldo)
          </label>
          <input
            id={`amount-${account.sessionId}`}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder={formatMoney(summary.pendingCents)}
            value={amount}
          />
          <label htmlFor={`tip-${account.sessionId}`}>Propina (opcional)</label>
          <input
            id={`tip-${account.sessionId}`}
            inputMode="decimal"
            onChange={(event) => setTip(event.target.value)}
            value={tip}
          />
          <p className="waiter-note">
            Se registra el cobro, no se pide ningún dato de la tarjeta.
          </p>
          <button
            className="button button--primary"
            disabled={busy !== null || !amountValid || toCollect <= 0}
            type="submit"
          >
            Registrar cobro de {formatMoney(toCollect + (typedTip ?? 0))}
          </button>
        </form>
      ) : null}

      {panel === "discount" && isManager && owes ? (
        <form
          className="waiter-reject account-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!discountValid || typedValue === null) return;
            onDiscount(account.sessionId, {
              kind,
              reason: reason.trim(),
              value: typedValue
            });
          }}
        >
          <label htmlFor={`kind-${account.sessionId}`}>Tipo de descuento</label>
          <select
            id={`kind-${account.sessionId}`}
            onChange={(event) =>
              setKind(event.target.value as "amount" | "percent")
            }
            value={kind}
          >
            <option value="percent">Porcentaje del saldo</option>
            <option value="amount">Monto fijo</option>
          </select>
          <label htmlFor={`value-${account.sessionId}`}>
            {kind === "percent" ? "Porcentaje" : "Monto"}
          </label>
          <input
            id={`value-${account.sessionId}`}
            inputMode="decimal"
            onChange={(event) => setValue(event.target.value)}
            value={value}
          />
          <label htmlFor={`discount-reason-${account.sessionId}`}>
            Motivo del descuento (obligatorio)
          </label>
          <textarea
            id={`discount-reason-${account.sessionId}`}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={2}
            value={reason}
          />
          <button
            className="button button--secondary"
            disabled={busy !== null || !discountValid}
            type="submit"
          >
            Aplicar descuento
          </button>
        </form>
      ) : null}
      {panel === "split" && cashOpen ? (
        <div className="waiter-reject account-form" data-testid="split-panel">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (partsValid) onSplit(account.sessionId, partsNumber);
            }}
          >
            <label htmlFor={`parts-${account.sessionId}`}>
              Partes iguales del saldo pendiente
            </label>
            <input
              id={`parts-${account.sessionId}`}
              inputMode="numeric"
              onChange={(event) => setParts(event.target.value)}
              value={parts}
            />
            <button
              className="button button--secondary"
              disabled={busy !== null || !partsValid}
              type="submit"
            >
              {split ? "Volver a dividir" : "Dividir"}
            </button>
          </form>
          {account.liveItems.length > 0 ? (
            <form
              aria-label="Dividir por consumo"
              onSubmit={(event) => {
                event.preventDefault();
                if (!personsValid) return;
                onItemSplit(
                  account.sessionId,
                  personsNumber,
                  account.liveItems.flatMap((item) => {
                    const owner = Number(owners[item.lineId] ?? "");
                    return owner >= 1 && owner <= personsNumber
                      ? [{ lineId: item.lineId, position: owner }]
                      : [];
                  })
                );
              }}
            >
              <label htmlFor={`persons-${account.sessionId}`}>
                Personas (por consumo)
              </label>
              <input
                id={`persons-${account.sessionId}`}
                inputMode="numeric"
                onChange={(event) => setPersons(event.target.value)}
                value={persons}
              />
              <ul className="waiter-lines">
                {account.liveItems.map((item) => (
                  <li key={item.lineId}>
                    <label htmlFor={`owner-${item.lineId}`}>
                      {item.quantity} × {item.title} ·{" "}
                      {formatMoney(item.totalCents)}
                    </label>
                    <select
                      id={`owner-${item.lineId}`}
                      onChange={(event) =>
                        setOwners({
                          ...owners,
                          [item.lineId]: event.target.value
                        })
                      }
                      value={owners[item.lineId] ?? ""}
                    >
                      <option value="">Compartido</option>
                      {Array.from(
                        { length: personsValid ? personsNumber : 0 },
                        (_, index) => (
                          <option key={index + 1} value={String(index + 1)}>
                            Persona {index + 1}
                          </option>
                        )
                      )}
                    </select>
                  </li>
                ))}
              </ul>
              <button
                className="button button--secondary"
                disabled={busy !== null || !personsValid}
                type="submit"
              >
                Dividir por consumo
              </button>
            </form>
          ) : null}
          {split ? (
            <>
              <ul className="waiter-lines" aria-label="Partes de la cuenta">
                {split.shares.map((share) => (
                  <li key={share.position}>
                    {share.status === "open" || share.status === "claimed" ? (
                      <label>
                        <input
                          checked={picked.includes(share.position)}
                          onChange={(event) =>
                            setPicked(
                              event.target.checked
                                ? [...picked, share.position]
                                : picked.filter((p) => p !== share.position)
                            )
                          }
                          type="checkbox"
                        />{" "}
                        Parte {share.position}
                        {share.status === "claimed"
                          ? ` · reservada por ${share.payerLabel}`
                          : ""}
                      </label>
                    ) : (
                      <span>
                        Parte {share.position} ·{" "}
                        {share.status === "paid"
                          ? `pagada${share.payerLabel ? ` por ${share.payerLabel}` : ""}`
                          : "anulada"}
                      </span>
                    )}
                    <b>{formatMoney(share.amountCents)}</b>
                  </li>
                ))}
              </ul>
              {openShares.length > 0 ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (pickedShares.length === 0) return;
                    onPayShares(account.sessionId, {
                      method: shareMethod,
                      payerLabel: payer.trim() === "" ? null : payer.trim(),
                      positions: pickedShares.map((share) => share.position),
                      splitId: split.splitId,
                      tipCents: 0
                    });
                    setPicked([]);
                    setPayer("");
                  }}
                >
                  <label htmlFor={`share-payer-${account.sessionId}`}>
                    Quién paga (opcional)
                  </label>
                  <input
                    id={`share-payer-${account.sessionId}`}
                    maxLength={40}
                    onChange={(event) => setPayer(event.target.value)}
                    value={payer}
                  />
                  <label htmlFor={`share-method-${account.sessionId}`}>
                    Medio de pago de las partes
                  </label>
                  <select
                    id={`share-method-${account.sessionId}`}
                    onChange={(event) =>
                      setShareMethod(event.target.value as AccountPaymentMethod)
                    }
                    value={shareMethod}
                  >
                    {paymentMethodChoices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <p className="waiter-note">
                    Se registra el cobro, no se pide ningún dato de la tarjeta.
                  </p>
                  <button
                    className="button button--primary"
                    disabled={busy !== null || pickedShares.length === 0}
                    type="submit"
                  >
                    {pickedShares.length === 0
                      ? "Elegí las partes a cobrar"
                      : `Cobrar ${pickedShares.length} parte${pickedShares.length === 1 ? "" : "s"} · ${formatMoney(pickedTotal)}`}
                  </button>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {panel === "refund" && isManager && cashOpen ? (
        <form
          className="waiter-reject account-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!refundValid || refundCents === null) return;
            onRefund(account.sessionId, {
              amountCents: refundCents,
              paymentId: refundPayment,
              reason: refundReason.trim()
            });
          }}
        >
          <label htmlFor={`refund-payment-${account.sessionId}`}>
            Pago a devolver
          </label>
          <select
            id={`refund-payment-${account.sessionId}`}
            onChange={(event) => setRefundPayment(event.target.value)}
            value={refundPayment}
          >
            <option value="">Elegí el pago…</option>
            {payments.map((payment) => (
              <option key={payment.paymentId} value={payment.paymentId}>
                {payment.label}
              </option>
            ))}
          </select>
          <label htmlFor={`refund-amount-${account.sessionId}`}>
            Monto a devolver
          </label>
          <input
            id={`refund-amount-${account.sessionId}`}
            inputMode="decimal"
            onChange={(event) => setRefundAmount(event.target.value)}
            value={refundAmount}
          />
          <label htmlFor={`refund-reason-${account.sessionId}`}>
            Motivo de la devolución (obligatorio)
          </label>
          <textarea
            id={`refund-reason-${account.sessionId}`}
            maxLength={200}
            onChange={(event) => setRefundReason(event.target.value)}
            rows={2}
            value={refundReason}
          />
          <p className="waiter-note">
            Solo se devuelve hasta el saldo a favor de la cuenta y hasta lo
            cobrado en ese pago. No se pide ningún dato de la tarjeta.
          </p>
          <button
            className="button button--secondary"
            disabled={busy !== null || !refundValid}
            type="submit"
          >
            Registrar devolución
          </button>
        </form>
      ) : null}
      {panel === "online-refund" && isManager ? (
        <form
          className="waiter-reject account-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!onlineValid || onlineCents === null) return;
            onOnlineRefund(account.sessionId, {
              amountCents: onlineCents,
              paymentId: onlinePayment,
              reason: onlineReason.trim()
            });
          }}
        >
          <label htmlFor={`online-payment-${account.sessionId}`}>
            Pago de Mercado Pago a devolver
          </label>
          <select
            id={`online-payment-${account.sessionId}`}
            onChange={(event) => setOnlinePayment(event.target.value)}
            value={onlinePayment}
          >
            <option value="">Elegí el pago…</option>
            {onlinePayments.map((payment) => (
              <option key={payment.paymentId} value={payment.paymentId}>
                {payment.label}
              </option>
            ))}
          </select>
          <label htmlFor={`online-amount-${account.sessionId}`}>
            Monto a devolver por Mercado Pago
          </label>
          <input
            id={`online-amount-${account.sessionId}`}
            inputMode="decimal"
            onChange={(event) => setOnlineAmount(event.target.value)}
            value={onlineAmount}
          />
          <label htmlFor={`online-reason-${account.sessionId}`}>
            Motivo de la devolución online (obligatorio)
          </label>
          <textarea
            id={`online-reason-${account.sessionId}`}
            maxLength={200}
            onChange={(event) => setOnlineReason(event.target.value)}
            rows={2}
            value={onlineReason}
          />
          <p className="waiter-note">
            Mercado Pago procesa la devolución. No sale efectivo de la caja y
            nunca se solicitan datos de la tarjeta.
          </p>
          <button
            className="button button--secondary"
            disabled={busy !== null || !onlineValid}
            type="submit"
          >
            Devolver por Mercado Pago
          </button>
        </form>
      ) : null}
    </article>
  );
}

export function AccountsPanel(props: AccountsPanelProps) {
  return (
    <section aria-labelledby="accounts-title" className="waiter-section">
      <h2 id="accounts-title">Cuentas de mesa</h2>
      <p className="waiter-note">
        Consumido, cobrado y pendiente salen del libro de la cuenta: nada se
        reescribe, cada cobro, descuento o ajuste queda como un movimiento.
      </p>
      {!props.cashOpen ? (
        <p className="waiter-notice waiter-notice--error" role="alert">
          La caja está cerrada: no se pueden registrar cobros hasta que el
          Encargado la abra desde Caja.
        </p>
      ) : null}
      {props.accounts.length === 0 ? (
        <p className="waiter-empty">No hay cuentas abiertas en tus mesas.</p>
      ) : (
        <div className="waiter-list">
          {props.accounts.map((account) => (
            <AccountCard
              {...props}
              account={account}
              key={`${account.sessionId}:${account.summary.paidCents}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
