"use client";

import { useRef, useState } from "react";
import type { CatalogProduct } from "@platform/contracts";

import {
  catalogDescription,
  catalogTitle,
  formatMoney
} from "./diner-catalog-format";
import { DinerProductDetail } from "./diner-product-detail";
import type { PublicCatalog } from "./public-catalog";

export function DinerMenu({
  catalog,
  onAdd
}: {
  catalog: PublicCatalog;
  onAdd(
    product: CatalogProduct,
    variantId: string | null,
    quantity: number
  ): void;
}) {
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const categories = [...catalog.catalog.categories].sort(
    (left, right) => left.position - right.position
  );
  return (
    <>
      <div className="diner-menu">
        {categories.map((category) => {
          const products = catalog.catalog.products
            .filter(({ categoryId }) => categoryId === category.id)
            .sort((left, right) => left.position - right.position);
          if (products.length === 0) return null;
          return (
            <section
              aria-labelledby={`category-${category.id}`}
              key={category.id}
            >
              <h2 id={`category-${category.id}`}>
                {catalogTitle(category.content)}
              </h2>
              <ul className="diner-products">
                {products.map((product) => {
                  const isAvailable =
                    catalog.availability[product.id]?.isAvailable ?? true;
                  return (
                    <li
                      className={!isAvailable ? "is-unavailable" : ""}
                      key={product.id}
                    >
                      <button
                        aria-label={`Ver detalle de ${catalogTitle(product.content)}`}
                        onClick={(event) => {
                          openerRef.current = event.currentTarget;
                          setSelected(product);
                        }}
                        type="button"
                      >
                        <span>
                          <strong>{catalogTitle(product.content)}</strong>
                          {catalogDescription(product.content) ? (
                            <small>{catalogDescription(product.content)}</small>
                          ) : null}
                          {!isAvailable ? <em>No disponible</em> : null}
                        </span>
                        <b>{formatMoney(product.priceCents)}</b>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {selected ? (
        <DinerProductDetail
          isAvailable={catalog.availability[selected.id]?.isAvailable ?? true}
          onAdd={(variantId, quantity) => onAdd(selected, variantId, quantity)}
          onClose={() => {
            setSelected(null);
            window.setTimeout(() => openerRef.current?.focus(), 0);
          }}
          product={selected}
        />
      ) : null}
    </>
  );
}
