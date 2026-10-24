"use client";

import type {
  WaiterInProgressItem,
  WaiterOrderInProgress
} from "@platform/contracts";
import { useState } from "react";

import {
  differenceLabel,
  itemActions,
  orderStatusSummary
} from "../../../../../staff/orders-in-progress-view";
import { productionStatusLabel } from "../../../../../staff/production-view";
import {
  callAgeLabel,
  type WaiterMenuProduct
} from "../../../../../staff/waiter-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

type Panel = { kind: "cancel" | "propose" | "reject"; lineId: string };

export type OrdersInProgressProps = {
  busy: string | null;
  isManager: boolean;
  menu: WaiterMenuProduct[];
  now: number;
  onCancel(orderId: string, lineId: string, reason: string): void;
  onDecide(
    adjustmentId: string,
    decision: "accept" | "reject",
    reason: string | null
  ): void;
  onDeliver(orderId: string, lineId: string): void;
  onPropose(
    orderId: string,
    lineId: string,
    productId: string,
    variantId: string | null
  ): void;
  orders: WaiterOrderInProgress[];
};

/** Every product, and every variant of it, a shortage can be replaced with. */
function replacementOptions(menu: WaiterMenuProduct[]) {
  return menu.flatMap((product) => [
    {
      label: `${product.title} · ${formatMoney(product.priceCents)}`,
      value: `${product.id}|`
    },
    ...product.variants.map((variant) => ({
      label: `${product.title} (${variant.title}) · ${formatMoney(
        product.priceCents + variant.priceDeltaCents
      )}`,
      value: `${product.id}|${variant.id}`
    }))
  ]);
}

function ItemRow({
  busy,
  isManager,
  item,
  menu,
  onCancel,
  onDecide,
  onDeliver,
  onPropose,
  order,
  panel,
  setPanel
}: Omit<OrdersInProgressProps, "now" | "orders"> & {
  item: WaiterInProgressItem;
  order: WaiterOrderInProgress;
  panel: Panel | null;
  setPanel(panel: Panel | null): void;
}) {
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState("");
  const actions = itemActions(item, isManager);
  const open = panel?.lineId === item.lineId ? panel.kind : null;
  const label = `${item.quantity} × ${item.title}${
    item.variantTitle ? ` (${item.variantTitle})` : ""
  }, mesa ${order.tableLabel}`;
  const proposal =
    item.adjustment?.kind === "replacement" &&
    item.adjustment.status === "proposed"
      ? item.adjustment
      : null;
  const options = replacementOptions(menu);
  const toggle = (kind: Panel["kind"]) => {
    setReason("");
    setPanel(open === kind ? null : { kind, lineId: item.lineId });
  };

  return (
    <li data-status={item.status}>
      <span className="orders-item-text">
        {item.quantity} × {item.title}
        {item.variantTitle ? ` (${item.variantTitle})` : ""}
        <small> · {productionStatusLabel(item.status)}</small>
        {item.status === "exception" && item.exceptionReason ? (
          <small className="waiter-exception">
            Faltante: {item.exceptionReason}
          </small>
        ) : null}
        {proposal ? (
          <small className="waiter-exception">
            Reemplazo propuesto: {proposal.replacementTitle} ·{" "}
            {differenceLabel(proposal.differenceCents)}
          </small>
        ) : null}
        {item.status === "replaced" && item.adjustment?.replacementTitle ? (
          <small>
            Se reemplazó por {item.adjustment.replacementTitle} ·{" "}
            {differenceLabel(item.adjustment.differenceCents)}
          </small>
        ) : null}
      </span>
      <span className="orders-item-actions">
        {actions.includes("deliver") ? (
          <button
            aria-label={`Entregar: ${label}`}
            className="button button--primary"
            disabled={busy !== null}
            onClick={() => onDeliver(order.orderId, item.lineId)}
            type="button"
          >
            Entregar
          </button>
        ) : null}
        {actions.includes("propose") ? (
          <button
            aria-expanded={open === "propose"}
            aria-label={`Proponer reemplazo: ${label}`}
            className="button button--secondary"
            disabled={busy !== null}
            onClick={() => toggle("propose")}
            type="button"
          >
            Proponer reemplazo
          </button>
        ) : null}
        {actions.includes("decide") && proposal ? (
          <>
            <button
              aria-label={`El comensal acepta el reemplazo: ${label}`}
              className="button button--primary"
              disabled={busy !== null}
              onClick={() => onDecide(proposal.id, "accept", null)}
              type="button"
            >
              El comensal acepta
            </button>
            <button
              aria-expanded={open === "reject"}
              aria-label={`El comensal rechaza el reemplazo: ${label}`}
              className="button button--secondary"
              disabled={busy !== null}
              onClick={() => toggle("reject")}
              type="button"
            >
              Rechaza…
            </button>
          </>
        ) : null}
        {actions.includes("cancel") ? (
          <button
            aria-expanded={open === "cancel"}
            aria-label={`Cancelar ítem: ${label}`}
            className="button button--secondary"
            disabled={busy !== null}
            onClick={() => toggle("cancel")}
            type="button"
          >
            Cancelar ítem…
          </button>
        ) : null}
      </span>
      {open === "propose" && actions.includes("propose") ? (
        <form
          className="waiter-reject orders-item-form"
          onSubmit={(event) => {
            event.preventDefault();
            const [productId, variantId] = choice.split("|");
            if (productId)
              onPropose(
                order.orderId,
                item.lineId,
                productId,
                variantId || null
              );
          }}
        >
          <label htmlFor={`replacement-${item.lineId}`}>
            Producto de reemplazo
          </label>
          <select
            id={`replacement-${item.lineId}`}
            onChange={(event) => setChoice(event.target.value)}
            required
            value={choice}
          >
            <option value="">Elegí un producto</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="button button--primary"
            disabled={busy !== null || choice === ""}
            type="submit"
          >
            Proponer al comensal
          </button>
        </form>
      ) : null}
      {(open === "reject" && proposal) ||
      (open === "cancel" && actions.includes("cancel")) ? (
        <form
          className="waiter-reject orders-item-form"
          onSubmit={(event) => {
            event.preventDefault();
            const text = reason.trim();
            if (text.length === 0) return;
            if (open === "cancel") onCancel(order.orderId, item.lineId, text);
            else if (proposal) onDecide(proposal.id, "reject", text);
          }}
        >
          <label htmlFor={`reason-${item.lineId}`}>
            {open === "cancel"
              ? "Motivo de la cancelación (obligatorio)"
              : "Motivo del rechazo (obligatorio)"}
          </label>
          <textarea
            id={`reason-${item.lineId}`}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={2}
            value={reason}
          />
          <button
            className="button button--secondary"
            disabled={busy !== null || reason.trim().length === 0}
            type="submit"
          >
            {open === "cancel" ? "Confirmar cancelación" : "Registrar rechazo"}
          </button>
        </form>
      ) : null}
    </li>
  );
}

function OrderCard(
  props: OrdersInProgressProps & { order: WaiterOrderInProgress }
) {
  const { now, order } = props;
  const [panel, setPanel] = useState<Panel | null>(null);
  const titleId = `order-${order.orderId}`;
  return (
    <article
      aria-labelledby={titleId}
      className="waiter-card"
      data-status={order.status}
    >
      <header>
        <h3 id={titleId}>
          Mesa {order.tableLabel}
          {order.attribution === "individual"
            ? ` · ${order.dinerName ?? ""}${order.seatLabel ? ` · ${order.seatLabel}` : ""}`
            : ""}
        </h3>
        <p>{callAgeLabel(order.confirmedAt, now)}</p>
        <p className="waiter-chip">{orderStatusSummary(order.status)}</p>
      </header>
      <ul className="waiter-lines orders-items">
        {order.items.map((item) => (
          <ItemRow
            {...props}
            item={item}
            key={item.lineId}
            order={order}
            panel={panel}
            setPanel={setPanel}
          />
        ))}
      </ul>
      <p className="waiter-total">
        Pedido <b>{formatMoney(order.totalCents)}</b>
        {order.adjustmentCents !== 0 ? (
          <>
            {" "}
            · Ajustes <b>{differenceLabel(order.adjustmentCents)}</b>
          </>
        ) : null}
      </p>
    </article>
  );
}

export function OrdersInProgress(props: OrdersInProgressProps) {
  return (
    <section aria-labelledby="orders-title" className="waiter-section">
      <h2 id="orders-title">Pedidos en curso</h2>
      <p className="waiter-note">
        Cada ítem avanza solo en Cocina y Barra. Acá entregás lo que está listo
        y resolvés los faltantes. Cerrar el aviso de confirmación no cancela
        nada.
      </p>
      {props.orders.length === 0 ? (
        <p className="waiter-empty">No hay pedidos en curso en tus mesas.</p>
      ) : (
        <div className="waiter-list">
          {props.orders.map((order) => (
            <OrderCard {...props} key={order.orderId} order={order} />
          ))}
        </div>
      )}
    </section>
  );
}
