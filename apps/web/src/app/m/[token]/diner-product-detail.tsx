"use client";

import type { CatalogProduct, CatalogVariant } from "@platform/contracts";
import { useEffect, useRef, useState } from "react";

import {
  formatMoney,
  localizedDescription,
  localizedTitle
} from "./diner-catalog-format";
import { DinerProductImage } from "./diner-product-image";

export function DinerProductDetail({
  isAvailable,
  language,
  onAdd,
  onClose,
  product
}: {
  isAvailable: boolean;
  language: string | null;
  onAdd(variantId: string | null, quantity: number): void;
  onClose(): void;
  product: CatalogProduct;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const variants: (CatalogVariant | null)[] = [null, ...product.variants];
  const title = localizedTitle(product.content, language);
  const description = localizedDescription(product.content, language);
  return (
    <dialog
      aria-labelledby="product-detail-title"
      className="diner-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
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
      <DinerProductImage size="hero" title={title.text} />
      <p className="eyebrow">Detalle</p>
      <h2 id="product-detail-title" lang={title.language}>
        {title.text}
      </h2>
      {description ? (
        <p className="diner-product-description" lang={description.language}>
          {description.text}
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
              <span
                lang={
                  variant
                    ? localizedTitle(variant.content, language).language
                    : "es"
                }
              >
                {variant
                  ? localizedTitle(variant.content, language).text
                  : "Clásica"}
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
        <p className="diner-product-price">{formatMoney(product.priceCents)}</p>
      )}
      <label className="diner-quantity">
        Cantidad
        <input
          max={20}
          min={1}
          onChange={(event) => {
            const nextQuantity = Number(event.target.value);
            setQuantity(
              Number.isSafeInteger(nextQuantity)
                ? Math.min(20, Math.max(1, nextQuantity))
                : 1
            );
          }}
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
    </dialog>
  );
}
