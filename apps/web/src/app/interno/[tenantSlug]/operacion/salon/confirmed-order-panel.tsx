"use client";

import type { WaiterOrderResult } from "@platform/contracts";

import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

/**
 * Confirming is not charging. Both account decisions are shown as separate,
 * later steps and stay unavailable: no payment, balance or ledger exists yet.
 */
export function ConfirmedOrderPanel({
  onDismiss,
  order,
  tableLabel
}: {
  onDismiss(): void;
  order: WaiterOrderResult;
  tableLabel: string;
}) {
  return (
    <section
      aria-labelledby={`confirmed-${order.orderId}`}
      className="waiter-result"
    >
      <h3 id={`confirmed-${order.orderId}`}>
        Pedido confirmado · {tableLabel}
      </h3>
      <ul className="waiter-lines">
        {order.items.map((item) => (
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
        Total del pedido <b>{formatMoney(order.totalCents)}</b>
      </p>
      <p className="waiter-note">
        Pago: <strong>no registrado</strong>. Confirmar no cobra, no abre la
        cuenta de la mesa ni envía el pedido a producción.
      </p>
      <div
        aria-label="Decisiones posteriores sobre la cuenta"
        className="waiter-next-steps"
        role="group"
      >
        <button
          aria-disabled="true"
          className="button button--secondary"
          type="button"
        >
          Cobrar ahora
        </button>
        <button
          aria-disabled="true"
          className="button button--secondary"
          type="button"
        >
          Dejar cuenta abierta
        </button>
        <small>
          Disponibles cuando se habilite la cuenta de mesa. Son decisiones
          separadas de la confirmación.
        </small>
      </div>
      <button
        className="button button--secondary"
        onClick={onDismiss}
        type="button"
      >
        Entendido
      </button>
    </section>
  );
}
