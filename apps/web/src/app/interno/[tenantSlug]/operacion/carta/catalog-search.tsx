"use client";

import { useState } from "react";

import { searchWaiterMenu } from "../../../../../staff/menu-search";
import type { WaiterMenuProduct } from "../../../../../staff/waiter-view";
import { formatMoney } from "../../../../m/[token]/diner-catalog-format";
import { AvailabilityButton } from "./availability-button";

type Product = WaiterMenuProduct & {
  available: boolean;
  version: number | null;
};
const pageSize = 8;

export function StaffCatalogSearch({
  products,
  canChangeAvailability,
  tenantSlug
}: {
  products: Product[];
  canChangeAvailability: boolean;
  tenantSlug: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const matches = searchWaiterMenu(products, query);
  const lastPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const visiblePage = Math.min(page, lastPage);
  const visible = matches.slice(
    visiblePage * pageSize,
    (visiblePage + 1) * pageSize
  );

  return (
    <div className="staff-catalog-search">
      <label className="waiter-field">
        Buscar en la carta
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Producto o categoría"
        />
      </label>
      {matches.length ? (
        <ul className="waiter-menu">
          {visible.map((product) => (
            <li key={product.id}>
              <div>
                <strong>{product.title}</strong>
                <small>
                  {product.categoryTitle} · {formatMoney(product.priceCents)} ·{" "}
                  {product.available ? "Disponible" : "Agotado"}
                </small>
              </div>
              {canChangeAvailability ? (
                <AvailabilityButton
                  available={product.available}
                  productId={product.id}
                  tenantSlug={tenantSlug}
                  title={product.title}
                  version={product.version}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p role="status">No encontramos productos.</p>
      )}
      {lastPage > 0 ? (
        <div className="staff-catalog-search__pages">
          <button
            className="button button--secondary"
            type="button"
            disabled={visiblePage === 0}
            onClick={() => setPage(visiblePage - 1)}
          >
            Anterior
          </button>
          <span aria-live="polite">
            {visiblePage + 1} de {lastPage + 1}
          </span>
          <button
            className="button button--secondary"
            type="button"
            disabled={visiblePage === lastPage}
            onClick={() => setPage(visiblePage + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </div>
  );
}
