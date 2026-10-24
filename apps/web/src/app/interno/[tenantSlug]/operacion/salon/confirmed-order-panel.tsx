"use client";

import type { WaiterOrderResult } from "@platform/contracts";

import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

/**
 * Confirming is not charging. Collecting now and leaving the account open are
 * two separate decisions that come after it, each on the table's account.
 */
export function ConfirmedOrderPanel({
  accountLabel,
  busy,
  onCollectNow,
  onDismiss,
  onKeepOpen,
  onOpenOrders,
  order,
  tableLabel
}: {
  /** Balance of the table's account, once it is known. */
  accountLabel: string | null;
  busy: boolean;
  onCollectNow(): void;
  onDismiss(): void;
  onKeepOpen(): void;
  onOpenOrders(): void;
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
        Pago: <strong>no registrado</strong>. Confirmar no cobra: el pedido ya
        quedó en la cuenta de la mesa
        {accountLabel ? ` (${accountLabel})` : ""}.
      </p>
      <div
        aria-label="Decisiones sobre la cuenta"
        className="waiter-next-steps"
        role="group"
      >
        <button
          className="button button--primary"
          disabled={busy}
          onClick={onCollectNow}
          type="button"
        >
          Cobrar ahora
        </button>
        <button
          className="button button--secondary"
          disabled={busy}
          onClick={onKeepOpen}
          type="button"
        >
          Dejar cuenta abierta
        </button>
        <small>
          Son decisiones separadas de la confirmación: cobrás ahora o dejás la
          cuenta abierta y cobrás después desde Cuentas.
        </small>
      </div>
      <button
        className="button button--primary"
        onClick={onOpenOrders}
        type="button"
      >
        Ver en pedidos en curso
      </button>
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
