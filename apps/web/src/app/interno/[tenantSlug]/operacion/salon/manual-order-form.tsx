"use client";

import type { WaiterManualOrderRequest } from "@platform/contracts";
import { useState } from "react";

import type { WaiterMenuProduct } from "../../../../../staff/waiter-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";

type Line = {
  key: string;
  lineId: string;
  productId: string;
  quantity: number;
  variantId: string | null;
};

export type ManualOrderDraft = Omit<WaiterManualOrderRequest, "commandId">;

export function ManualOrderForm({
  busy,
  menu,
  onSubmit,
  tables
}: {
  busy: boolean;
  menu: WaiterMenuProduct[];
  onSubmit(draft: ManualOrderDraft): Promise<boolean>;
  tables: { id: string; label: string }[];
}) {
  const [tableId, setTableId] = useState(tables[0]?.id ?? "");
  const [attribution, setAttribution] = useState<"individual" | "table">(
    "table"
  );
  const [dinerName, setDinerName] = useState("");
  const [seatLabel, setSeatLabel] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [variantByProduct, setVariantByProduct] = useState<
    Record<string, string>
  >({});

  const products = new Map(menu.map((product) => [product.id, product]));
  const estimate = lines.reduce((sum, line) => {
    const product = products.get(line.productId);
    const delta =
      product?.variants.find((variant) => variant.id === line.variantId)
        ?.priceDeltaCents ?? 0;
    return sum + ((product?.priceCents ?? 0) + delta) * line.quantity;
  }, 0);
  const individual = attribution === "individual";
  const ready =
    tableId !== "" &&
    lines.length > 0 &&
    (!individual ||
      (dinerName.trim().length > 0 && seatLabel.trim().length > 0));

  function add(product: WaiterMenuProduct) {
    const variantId = variantByProduct[product.id] || null;
    const key = `${product.id}:${variantId ?? ""}`;
    setLines((current) => {
      const existing = current.find((line) => line.key === key);
      if (existing) {
        return current.map((line) =>
          line.key === key
            ? { ...line, quantity: Math.min(20, line.quantity + 1) }
            : line
        );
      }
      return [
        ...current,
        {
          key,
          lineId: crypto.randomUUID(),
          productId: product.id,
          quantity: 1,
          variantId
        }
      ];
    });
  }

  if (tables.length === 0) {
    return (
      <section aria-labelledby="manual-title" className="waiter-section">
        <h2 id="manual-title">Cargar comanda</h2>
        <p className="waiter-empty">
          No tenés mesas asignadas para cargar pedidos.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="manual-title" className="waiter-section">
      <h2 id="manual-title">Cargar comanda</h2>
      <form
        className="waiter-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          const accepted = await onSubmit({
            attribution,
            dinerName: dinerName.trim() === "" ? null : dinerName.trim(),
            items: lines.map((line) => ({
              lineId: line.lineId,
              productId: line.productId,
              quantity: line.quantity,
              variantId: line.variantId
            })),
            seatLabel: seatLabel.trim() === "" ? null : seatLabel.trim(),
            tableId
          });
          if (accepted) {
            setLines([]);
            setDinerName("");
            setSeatLabel("");
          }
        }}
      >
        <div className="waiter-field">
          <label htmlFor="manual-table">Mesa</label>
          <select
            id="manual-table"
            onChange={(event) => setTableId(event.target.value)}
            value={tableId}
          >
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                Mesa {table.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="waiter-field">
          <legend>¿A quién se carga?</legend>
          <label>
            <input
              checked={attribution === "table"}
              name="attribution"
              onChange={() => setAttribution("table")}
              type="radio"
            />
            A la mesa
          </label>
          <label>
            <input
              checked={attribution === "individual"}
              name="attribution"
              onChange={() => setAttribution("individual")}
              type="radio"
            />
            A una persona
          </label>
        </fieldset>

        <div className="waiter-field">
          <label htmlFor="manual-name">
            Nombre{individual ? " (obligatorio)" : " (opcional)"}
          </label>
          <input
            autoComplete="off"
            id="manual-name"
            maxLength={80}
            onChange={(event) => setDinerName(event.target.value)}
            required={individual}
            value={dinerName}
          />
        </div>
        <div className="waiter-field">
          <label htmlFor="manual-seat">
            Silla{individual ? " (obligatoria)" : " (opcional)"}
          </label>
          <input
            autoComplete="off"
            id="manual-seat"
            maxLength={40}
            onChange={(event) => setSeatLabel(event.target.value)}
            required={individual}
            value={seatLabel}
          />
        </div>

        <h3>Carta</h3>
        <ul className="waiter-menu">
          {menu.map((product) => (
            <li key={product.id}>
              <div>
                <strong>{product.title}</strong>
                <small>
                  {product.categoryTitle} · {formatMoney(product.priceCents)}
                </small>
              </div>
              {product.variants.length > 0 ? (
                <select
                  aria-label={`Opción de ${product.title}`}
                  onChange={(event) =>
                    setVariantByProduct((current) => ({
                      ...current,
                      [product.id]: event.target.value
                    }))
                  }
                  value={variantByProduct[product.id] ?? ""}
                >
                  <option value="">Sin opción</option>
                  {product.variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.title} (+{formatMoney(variant.priceDeltaCents)})
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                className="button button--secondary"
                onClick={() => add(product)}
                type="button"
              >
                Agregar {product.title}
              </button>
            </li>
          ))}
        </ul>

        <h3>Comanda</h3>
        {lines.length === 0 ? (
          <p className="waiter-empty">Todavía no agregaste productos.</p>
        ) : (
          <ul className="waiter-lines" aria-live="polite">
            {lines.map((line) => {
              const product = products.get(line.productId);
              const variant = product?.variants.find(
                (entry) => entry.id === line.variantId
              );
              const label = `${product?.title ?? ""}${variant ? ` (${variant.title})` : ""}`;
              return (
                <li key={line.key}>
                  <span>{label}</span>
                  <input
                    aria-label={`Cantidad de ${label}`}
                    max={20}
                    min={1}
                    onChange={(event) => {
                      const quantity = Math.min(
                        20,
                        Math.max(1, Number(event.target.value) || 1)
                      );
                      setLines((current) =>
                        current.map((entry) =>
                          entry.key === line.key
                            ? { ...entry, quantity }
                            : entry
                        )
                      );
                    }}
                    type="number"
                    value={line.quantity}
                  />
                  <button
                    aria-label={`Quitar ${label}`}
                    className="button button--secondary"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((entry) => entry.key !== line.key)
                      )
                    }
                    type="button"
                  >
                    Quitar
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="waiter-total">
          Estimado <b>{formatMoney(estimate)}</b>
          <small> · El total final lo calcula el servidor con la carta.</small>
        </p>
        <p className="waiter-note">
          Confirmar la comanda no cobra ni abre la cuenta.
        </p>
        <button
          className="button button--primary"
          disabled={!ready || busy}
          type="submit"
        >
          Confirmar comanda
        </button>
      </form>
    </section>
  );
}
