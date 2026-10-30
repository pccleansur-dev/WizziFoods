"use client";

import type { WaiterCallView, WaiterIntentView } from "@platform/contracts";
import { useState } from "react";

import {
  callAgeLabel,
  paymentMethodLabel
} from "../../../../../staff/waiter-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

type Props = {
  busy: string | null;
  calls: WaiterCallView[];
  canOverrideClaim: boolean;
  intents: WaiterIntentView[];
  now: number;
  onClaim(callId: string): void;
  onConfirm(intentId: string): void;
  onReject(intentId: string, reason: string): void;
};

function IntentCard({
  busy,
  call,
  canOverrideClaim,
  intent,
  now,
  onClaim,
  onConfirm,
  onReject
}: Omit<Props, "calls" | "intents"> & {
  call: WaiterCallView | undefined;
  intent: WaiterIntentView;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const claimedByOther = call?.status === "acknowledged" && !call.claimedByMe;
  const blocked = claimedByOther && !canOverrideClaim;
  const disabled = busy !== null || blocked;
  const titleId = `pending-${intent.id}`;
  const reasonId = `reason-${intent.id}`;

  return (
    <article aria-labelledby={titleId} className="waiter-card">
      <header>
        <h3 id={titleId}>
          Mesa {intent.tableLabel} · {intent.dinerName}
        </h3>
        <p>
          {intent.attribution === "individual"
            ? `Consumo propio${intent.seatLabel ? ` · ${intent.seatLabel}` : ""}`
            : "Cuenta general"}{" "}
          · {paymentMethodLabel(intent.paymentMethod)} ·{" "}
          {callAgeLabel(intent.createdAt, now)}
        </p>
      </header>
      <ul className="waiter-lines">
        {intent.items.map((item) => (
          <li key={item.lineId}>
            <span>
              {item.quantity} × {item.title}
              {item.variantTitle ? ` (${item.variantTitle})` : ""}
            </span>
            <b>{formatMoney(item.totalCents)}</b>
          </li>
        ))}
      </ul>
      <p className="waiter-total">
        Total <b>{formatMoney(intent.totalCents)}</b>
      </p>
      {call?.status === "acknowledged" ? (
        <p className="waiter-chip waiter-chip--claimed">
          {call.claimedByMe
            ? "Lo estás atendiendo"
            : `Lo atiende ${call.claimedByName ?? "otro mozo"}`}
        </p>
      ) : (
        <p className="waiter-chip waiter-chip--open">Sin atender</p>
      )}
      <p className="waiter-note">
        Confirmar valida los productos con la mesa. No cobra ni abre la cuenta.
      </p>
      <div className="waiter-actions">
        {call?.status === "open" ? (
          <button
            className="button button--secondary"
            disabled={disabled}
            onClick={() => onClaim(call.id)}
            type="button"
          >
            Tomar llamado de mesa {intent.tableLabel}
          </button>
        ) : null}
        <button
          className="button button--primary"
          disabled={disabled}
          onClick={() => onConfirm(intent.id)}
          type="button"
        >
          Confirmar pedido de mesa {intent.tableLabel}
        </button>
        <button
          aria-expanded={rejecting}
          className="button button--secondary"
          disabled={disabled}
          onClick={() => setRejecting((value) => !value)}
          type="button"
        >
          Rechazar…
        </button>
      </div>
      {blocked ? (
        <p className="waiter-note" role="status">
          Este llamado lo atiende otro mozo; sólo él o un encargado puede
          resolverlo.
        </p>
      ) : null}
      {rejecting ? (
        <form
          className="waiter-reject"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim().length > 0) onReject(intent.id, reason.trim());
          }}
        >
          <label htmlFor={reasonId}>Motivo del rechazo (obligatorio)</label>
          <textarea
            id={reasonId}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={2}
            value={reason}
          />
          <button
            className="button button--secondary"
            disabled={disabled || reason.trim().length === 0}
            type="submit"
          >
            Rechazar pedido
          </button>
        </form>
      ) : null}
    </article>
  );
}

export function WaiterPending(props: Props) {
  const callByIntent = new Map(
    props.calls.flatMap((call) =>
      call.intentId === null ? [] : [[call.intentId, call] as const]
    )
  );
  return (
    <section aria-labelledby="pending-title" className="waiter-section">
      <h2 id="pending-title">Llamados y pedidos por validar</h2>
      {props.intents.length === 0 ? (
        <p className="waiter-empty">No hay pedidos esperando validación.</p>
      ) : (
        <div className="waiter-list">
          {props.intents.map((intent) => (
            <IntentCard
              {...props}
              call={callByIntent.get(intent.id)}
              intent={intent}
              key={intent.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}
