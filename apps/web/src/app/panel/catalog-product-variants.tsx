"use client";

import type { CatalogDraft, CatalogProduct } from "@platform/contracts";
import { useState } from "react";

import {
  addCatalogVariant,
  formatPrice,
  parsePriceToCents,
  removeCatalogVariant,
  updateCatalogLocalizedContent
} from "./catalog-editor-state";
import { CatalogLocalizedFields } from "./catalog-localized-fields";

/**
 * Variantes de un producto: plegadas por defecto; al desplegar son una
 * sub-tabla. El estado de plegado es local para no tocar el del editor.
 */
export function ProductVariants({
  change,
  languages,
  previewLanguage,
  product
}: {
  change: (update: (current: CatalogDraft) => CatalogDraft) => void;
  languages: string[];
  previewLanguage: string;
  product: CatalogProduct;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="catalog-variants">
      <div className="catalog-variants__bar">
        <button
          aria-expanded={open}
          className="catalog-variants__toggle"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> Variantes
          <span className="catalog-variants__count">
            {product.variants.length}
          </span>
        </button>
        <button
          aria-label="Agregar variante"
          className="button button--secondary"
          disabled={product.variants.length >= 30}
          onClick={() => {
            change((current) =>
              addCatalogVariant(current, product.id, undefined, languages)
            );
            setOpen(true);
          }}
          type="button"
        >
          + Variante
        </button>
      </div>
      {open && product.variants.length > 0 ? (
        <div className="catalog-variants__table">
          <div aria-hidden="true" className="catalog-variants__head">
            <span>Variante</span>
            <span>Adicional ($)</span>
            <span />
          </div>
          {product.variants.map((variant) => (
            <div className="catalog-variant" key={variant.id}>
              <div className="catalog-product__heading">
                <strong>
                  {variant.content.find(
                    ({ language }) => language === previewLanguage
                  )?.title || "Variante sin nombre"}
                </strong>
                <button
                  className="catalog-remove"
                  onClick={() =>
                    change((current) =>
                      removeCatalogVariant(current, product.id, variant.id)
                    )
                  }
                  type="button"
                >
                  Quitar
                </button>
              </div>
              <label className="field-group catalog-variant__price">
                <span>Adicional en pesos</span>
                <input
                  inputMode="decimal"
                  onChange={(event) => {
                    const cents = parsePriceToCents(event.target.value);
                    if (cents !== null) {
                      change((current) => ({
                        ...current,
                        products: current.products.map((value) =>
                          value.id === product.id
                            ? {
                                ...value,
                                variants: value.variants.map((item) =>
                                  item.id === variant.id
                                    ? {
                                        ...item,
                                        priceDeltaCents: cents
                                      }
                                    : item
                                )
                              }
                            : value
                        )
                      }));
                    }
                  }}
                  pattern="[0-9]+(?:,[0-9]{1,2})?"
                  value={formatPrice(variant.priceDeltaCents)}
                />
              </label>
              <CatalogLocalizedFields
                content={variant.content}
                languages={languages}
                legend="Contenido de la variante"
                onChange={(language, field, value) =>
                  change((current) =>
                    updateCatalogLocalizedContent(
                      current,
                      { id: variant.id, type: "variant" },
                      language,
                      field,
                      value
                    )
                  )
                }
                showDescription={false}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
