"use client";

import { useActionState } from "react";

import { enqueueCatalogImportAction } from "./actions";
import { CatalogImportReview } from "./catalog-import-review";
import type { CatalogImportActionState } from "./catalog-import-state";
import type { CatalogImportView } from "./catalog-import";

const sourceLabels = {
  csv: "CSV",
  image: "Foto",
  manual: "Carga manual",
  pdf: "PDF",
  xlsx: "XLSX"
};

const statusLabels = {
  approved: "Incorporada al borrador",
  discarded: "Descartada",
  failed: "Falló después de reintentos",
  processing: "Procesando",
  queued: "En cola",
  review: "Lista para revisar"
};

export function CatalogImportPanel({
  idempotencyKey,
  imports
}: {
  idempotencyKey: string;
  imports: CatalogImportView[];
}) {
  const initial: CatalogImportActionState = {
    idempotencyKey,
    message: "",
    status: "idle"
  };
  const [state, action, pending] = useActionState(
    enqueueCatalogImportAction,
    initial
  );

  return (
    <section className="catalog-import" aria-labelledby="catalog-import-title">
      <div className="catalog-section__heading">
        <div>
          <p className="eyebrow">Importación asistida</p>
          <h2 id="catalog-import-title">Traer una carta existente</h2>
          <p>
            Cada archivo se procesa en segundo plano. Nada se publica hasta que
            revises y apruebes el resultado.
          </p>
        </div>
      </div>
      <div className="catalog-import-entry">
        <form action={action} className="catalog-import-form">
          <input
            name="idempotencyKey"
            type="hidden"
            value={state.idempotencyKey}
          />
          <input name="mode" type="hidden" value="file" />
          <label className="field-group">
            <span>CSV, XLSX, PDF o foto</span>
            <input
              accept=".csv,.xlsx,.pdf,image/jpeg,image/png,image/webp"
              name="file"
              required
              type="file"
            />
            <small>
              Máximo 8 MB. Se verifica el contenido, no sólo la extensión.
            </small>
          </label>
          <button
            className="button button--primary"
            disabled={pending}
            type="submit"
          >
            {pending ? "Encolando…" : "Importar archivo"}
          </button>
        </form>
        <form action={action} className="catalog-import-form">
          <input
            name="idempotencyKey"
            type="hidden"
            value={state.idempotencyKey}
          />
          <input name="mode" type="hidden" value="manual" />
          <label className="field-group">
            <span>Producto</span>
            <input maxLength={120} name="name" required />
          </label>
          <label className="field-group">
            <span>Categoría</span>
            <input maxLength={120} name="category" />
          </label>
          <label className="field-group">
            <span>Descripción</span>
            <input maxLength={1000} name="description" />
          </label>
          <label className="field-group">
            <span>Precio</span>
            <input inputMode="decimal" maxLength={40} name="price" required />
          </label>
          <label className="field-group">
            <span>Sector</span>
            <input maxLength={80} name="sector" />
          </label>
          <button
            className="button button--secondary"
            disabled={pending}
            type="submit"
          >
            {pending ? "Encolando…" : "Agregar mediante la cola"}
          </button>
        </form>
      </div>
      {state.message ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
      <div className="catalog-import-list">
        {imports.length === 0 ? (
          <p className="catalog-helper">Todavía no hay importaciones.</p>
        ) : (
          imports.map((item) => (
            <article className="catalog-import-card" key={item.id}>
              <header>
                <div>
                  <strong>{sourceLabels[item.sourceKind]}</strong>
                  <span>{statusLabels[item.status]}</span>
                </div>
                <small>Intentos: {item.attemptCount}</small>
              </header>
              {item.status === "review" && item.draft ? (
                <CatalogImportReview draft={item.draft} importId={item.id} />
              ) : item.status === "failed" ? (
                <p role="alert">
                  El archivo no pudo procesarse tras los reintentos. La carga
                  manual sigue disponible.
                </p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
