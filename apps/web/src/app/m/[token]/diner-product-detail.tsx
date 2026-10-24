"use client";

import type { CatalogProduct, CatalogVariant } from "@platform/contracts";
import { useEffect, useRef, useState } from "react";

import {
  catalogDescription,
  catalogTitle,
  formatMoney
} from "./diner-catalog-format";

export function DinerProductDetail({
  isAvailable,
  onAdd,
  onClose,
  product
}: {
  isAvailable: boolean;
  onAdd(variantId: string | null, quantity: number): void;
  onClose(): void;
  product: CatalogProduct;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState<string | null>(null);

  useEffect(() => closeRef.current?.focus(), []);

  const variants: (CatalogVariant | null)[] = [null, ...product.variants];
  return (
    <div
      className="diner-dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        aria-labelledby="product-detail-title"
        aria-modal="true"
        className="diner-dialog"
        role="dialog"
      >
        <button
          aria-label="Cerrar detalle"
          className="diner-dialog-close"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          ×
        </button>
        <p className="eyebrow">Detalle</p>
        <h2 id="product-detail-title">{catalogTitle(product.content)}</h2>
        {catalogDescription(product.content) ? (
          <p className="diner-product-description">
            {catalogDescription(product.content)}
          </p>
        ) : null}
        {product.variants.length > 0 ? (
          <fieldset className="diner-variants">
            <legend>Elegí una opción</legend>
            {variants.map((variant) => (
              <label key={variant?.id ?? "base"}>
                <input
                  checked={variantId === (variant?.id ?? null)}
                  name="variant"
                  onChange={() => setVariantId(variant?.id ?? null)}
                  type="radio"
                />
                <span>
                  {variant ? catalogTitle(variant.content) : "Clásica"}
                </span>
                <strong>
                  {formatMoney(
                    product.priceCents + (variant?.priceDeltaCents ?? 0)
                  )}
                </strong>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="diner-product-price">
            {formatMoney(product.priceCents)}
          </p>
        )}
        <label className="diner-quantity">
          Cantidad
          <input
            max={20}
            min={1}
            onChange={(event) => setQuantity(Number(event.target.value))}
            type="number"
            value={quantity}
          />
        </label>
        {!isAvailable ? (
          <p className="diner-warning" role="status">
            Este producto no está disponible ahora.
          </p>
        ) : null}
        <button
          className="button diner-primary"
          disabled={!isAvailable}
          onClick={() => {
            onAdd(variantId, quantity);
            onClose();
          }}
          type="button"
        >
          Agregar a Mi pedido
        </button>
      </section>
    </div>
  );
}
