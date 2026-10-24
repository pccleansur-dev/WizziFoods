"use client";

import type { CatalogImportDraft } from "@platform/contracts";
import { useActionState, useState } from "react";

import {
  approveCatalogImportAction,
  discardCatalogImportAction
} from "./actions";
import type { CatalogImportActionState } from "./catalog-import-state";
import { newId } from "../../lib/new-id";

const idle = (idempotencyKey: string): CatalogImportActionState => ({
  idempotencyKey,
  message: "",
  status: "idle"
});

export function CatalogImportReview({
  draft: initialDraft,
  importId
}: {
  draft: CatalogImportDraft;
  importId: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [approveState, approveAction, approving] = useActionState(
    approveCatalogImportAction,
    idle(newId())
  );
  const [discardState, discardAction, discarding] = useActionState(
    discardCatalogImportAction,
    idle(newId())
  );

  const update = (
    itemId: string,
    name: "category" | "description" | "name" | "priceCents" | "sector",
    value: string
  ) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;
        if (name === "priceCents") {
          const normalized = value.replace(",", ".");
          const cents = /^\d+(?:\.\d{1,2})?$/u.test(normalized)
            ? Math.round(Number(normalized) * 100)
            : null;
          return {
            ...item,
            priceCents: {
              confidence: cents === null ? 0 : 1,
              doubtful: cents === null,
              value: cents
            }
          };
        }
        return {
          ...item,
          [name]: {
            ...item[name],
            confidence: value.trim() || name === "description" ? 1 : 0,
            doubtful: !value.trim() && name !== "description",
            value: value.trimStart()
          }
        };
      })
    }));
  };

  return (
    <div className="catalog-import-review">
      <p className="catalog-import-confidence">
        Confianza general: {Math.round(draft.overallConfidence * 100)}%
      </p>
      {draft.errors.length ? (
        <ul
          className="catalog-import-errors"
          aria-label="Errores de importación"
        >
          {draft.errors.map((error, index) => (
            <li key={`${error.code}-${error.rowNumber ?? index}`}>
              {error.rowNumber ? `Fila ${error.rowNumber}: ` : ""}
              {error.message}
            </li>
          ))}
        </ul>
      ) : null}
      {draft.items.map((item) => (
        <fieldset className="catalog-import-item" key={item.id}>
          <legend>Fila {item.rowNumber}</legend>
          {(["category", "name", "description", "sector"] as const).map(
            (fieldName) => (
              <label className="field-group" key={fieldName}>
                <span>
                  {fieldName === "category"
                    ? "Categoría"
                    : fieldName === "name"
                      ? "Producto"
                      : fieldName === "description"
                        ? "Descripción"
                        : "Sector"}
                  {item[fieldName].doubtful ? (
                    <em className="catalog-import-doubt">Campo dudoso</em>
                  ) : null}
                </span>
                <input
                  maxLength={fieldName === "description" ? 1000 : 120}
                  onChange={(event) =>
                    update(item.id, fieldName, event.target.value)
                  }
                  value={item[fieldName].value}
                />
                <small>
                  Confianza: {Math.round(item[fieldName].confidence * 100)}%
                </small>
              </label>
            )
          )}
          <label className="field-group">
            <span>
              Precio
              {item.priceCents.doubtful ? (
                <em className="catalog-import-doubt">Campo dudoso</em>
              ) : null}
            </span>
            <input
              inputMode="decimal"
              onChange={(event) =>
                update(item.id, "priceCents", event.target.value)
              }
              value={
                item.priceCents.value === null
                  ? ""
                  : (item.priceCents.value / 100).toFixed(2)
              }
            />
            <small>
              Confianza: {Math.round(item.priceCents.confidence * 100)}%
            </small>
          </label>
        </fieldset>
      ))}
      <div className="catalog-import-actions">
        <form action={approveAction}>
          <input name="importId" type="hidden" value={importId} />
          <input name="draft" type="hidden" value={JSON.stringify(draft)} />
          <button
            className="button button--primary"
            disabled={approving}
            type="submit"
          >
            {approving ? "Incorporando…" : "Aprobar e incorporar al borrador"}
          </button>
        </form>
        <form action={discardAction}>
          <input name="importId" type="hidden" value={importId} />
          <button
            className="button button--secondary"
            disabled={discarding}
            type="submit"
          >
            {discarding ? "Descartando…" : "Descartar importación"}
          </button>
        </form>
      </div>
      {[approveState, discardState].map((state, index) =>
        state.message ? (
          <p
            className={`form-message form-message--${state.status}`}
            key={index}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        ) : null
      )}
    </div>
  );
}
