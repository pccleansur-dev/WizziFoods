"use client";

import type { DinerDraftItem, DinerDraftQuote } from "@platform/contracts";

import { formatMoney } from "./diner-catalog-format";

const issueText = {
  product_missing: "Ya no forma parte de la carta.",
  product_unavailable: "No está disponible ahora.",
  variant_missing: "La opción elegida ya no existe."
} as const;

export function DinerOrder({
  error,
  items,
  loading,
  onQuantity,
  quote
}: {
  error: string | null;
  items: DinerDraftItem[];
  loading: boolean;
  onQuantity(lineId: string, quantity: number): void;
  quote: DinerDraftQuote | null;
}) {
  if (items.length === 0) {
    return (
      <section className="diner-empty" role="status">
        <h2>Tu pedido está vacío</h2>
        <p>Volvé a Carta y elegí lo que quieras pedir.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="order-title" className="diner-order">
      <h2 id="order-title">Mi pedido</h2>
      {loading ? <p aria-live="polite">Actualizando importes…</p> : null}
      {error ? (
        <p className="diner-warning" role="alert">
          {error}
        </p>
      ) : null}
      <ul>
        {quote?.items.map((item) => (
          <li key={item.lineId}>
            <div>
              <strong>{item.title}</strong>
              {item.variantTitle ? <small>{item.variantTitle}</small> : null}
              {item.status !== "available" ? (
                <p className="diner-warning">{issueText[item.status]}</p>
              ) : null}
            </div>
            <label>
              Cantidad de {item.title}
              <input
                aria-label={`Cantidad de ${item.title}`}
                max={20}
                min={0}
                onChange={(event) =>
                  onQuantity(item.lineId, Number(event.target.value))
                }
                type="number"
                value={item.quantity}
              />
            </label>
            <b>{formatMoney(item.totalCents)}</b>
            <button
              aria-label={`Quitar ${item.title}`}
              className="diner-remove"
              onClick={() => onQuantity(item.lineId, 0)}
              type="button"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <div className="diner-total">
        <span>Total</span>
        <strong>{quote ? formatMoney(quote.totalCents) : "—"}</strong>
      </div>
      <button
        className="button diner-primary"
        disabled={!quote?.canConfirm || loading}
        type="button"
      >
        Continuar
      </button>
      {quote && !quote.canConfirm ? (
        <p className="diner-help" role="status">
          Corregí los productos marcados o pedile ayuda al mozo para continuar.
        </p>
      ) : null}
    </section>
  );
}
