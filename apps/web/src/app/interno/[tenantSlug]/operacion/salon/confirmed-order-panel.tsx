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
      <p className="waiter-sent" role="status">
        ✓ Enviado a producción: cada ítem fue a Cocina o Barra según su sector.
      </p>
      <p className="waiter-note">
        Pago: <strong>no registrado</strong>. Confirmar no cobra ni abre la
        cuenta de la mesa (eso llega con la etapa de cuenta).
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
        Cerrar aviso
      </button>
      <p className="waiter-note">
        Cerrar el aviso no cancela ni borra el pedido: sigue su curso en Cocina
        y Barra.
      </p>
    </section>
  );
}
