"use client";

import { useRef, useState } from "react";
import type { CatalogProduct } from "@platform/contracts";

import {
  formatMoney,
  localizedDescription,
  localizedTitle
} from "./diner-catalog-format";
import { DinerProductImage } from "./diner-product-image";
import { DinerProductDetail } from "./diner-product-detail";
import type { PublicCatalog } from "./public-catalog";

export function DinerMenu({
  catalog,
  language,
  onAdd
}: {
  catalog: PublicCatalog;
  language: string | null;
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
              <h2
                id={`category-${category.id}`}
                lang={localizedTitle(category.content, language).language}
              >
                {localizedTitle(category.content, language).text}
              </h2>
              <ul className="diner-products">
                {products.map((product) => {
                  const isAvailable =
                    catalog.availability[product.id]?.isAvailable ?? true;
                  const title = localizedTitle(product.content, language);
                  const description = localizedDescription(
                    product.content,
                    language
                  );
                  return (
                    <li
                      className={!isAvailable ? "is-unavailable" : ""}
                      key={product.id}
                    >
                      <button
                        onClick={(event) => {
                          openerRef.current = event.currentTarget;
                          setSelected(product);
                        }}
                        type="button"
                      >
                        <span className="diner-product-text">
                          <strong lang={title.language}>
                            <span className="visually-hidden" lang="es">
                              Ver detalle de{" "}
                            </span>
                            {title.text}
                          </strong>
                          {description ? (
                            <small lang={description.language}>
                              {description.text}
                            </small>
                          ) : null}
                          {!isAvailable ? <em>No disponible</em> : null}
                          <b>{formatMoney(product.priceCents)}</b>
                        </span>
                        <DinerProductImage
                          imageAssetId={product.imageAssetId}
                          size="card"
                          title={title.text}
                        />
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
          language={language}
          product={selected}
        />
      ) : null}
    </>
  );
}
