"use client";

import type { CatalogDraft, CatalogSectorKind } from "@platform/contracts";
import { useActionState, useRef, useState } from "react";

import { publishCatalogAction, saveCatalogAction } from "./actions";
import type { CatalogActionState } from "./catalog-action-state";
import {
  addCatalogCategory,
  addCatalogProduct,
  addCatalogSector,
  createEmptyCatalogDraft,
  formatPrice,
  normalizeProductPositions,
  parsePriceToCents,
  removeCatalogCategory
} from "./catalog-editor-state";
import { CatalogPreview } from "./catalog-preview";
import type { SavedCatalogDraft } from "./catalog";
import { BusinessMediaUploadField } from "./business-media-upload-field";

const initialActionState = (
  catalog: SavedCatalogDraft | null
): CatalogActionState => ({
  draftRevision: catalog?.revision ?? null,
  message: "",
  publishedRevision: catalog?.basePublishedRevision ?? null,
  status: "idle"
});

function localizedUpdate(
  draft: CatalogDraft,
  type: "category" | "product",
  id: string,
  field: "description" | "title",
  value: string
): CatalogDraft {
  const key = type === "category" ? "categories" : "products";
  return {
    ...draft,
    [key]: draft[key].map((item) =>
      item.id === id
        ? {
            ...item,
            content: item.content.map((content, index) =>
              index === 0 ? { ...content, [field]: value } : content
            )
          }
        : item
    )
  } as CatalogDraft;
}

export function CatalogEditor({
  catalog
}: {
  catalog: SavedCatalogDraft | null;
}) {
  const initialDraft = catalog?.draft ?? createEmptyCatalogDraft();
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [saveState, saveAction, saving] = useActionState(
    async (previousState: CatalogActionState, formData: FormData) => {
      const submittedDraft = formData.get("catalog");
      const result = await saveCatalogAction(previousState, formData);
      if (
        result.status === "success" &&
        typeof submittedDraft === "string" &&
        JSON.stringify(draftRef.current) === submittedDraft
      ) {
        setDirty(false);
      }
      return result;
    },
    initialActionState(catalog)
  );
  const [publishState, publishAction, publishing] = useActionState(
    async (previousState: CatalogActionState, formData: FormData) => {
      const result = await publishCatalogAction(previousState, formData);
      if (result.status === "success" && result.publishedRevision !== null) {
        setDraft((current) => {
          const published = {
            ...current,
            baseRevision: result.publishedRevision
          };
          draftRef.current = published;
          return published;
        });
      }
      return result;
    },
    initialActionState(catalog)
  );

  const change = (update: (current: CatalogDraft) => CatalogDraft) => {
    setDraft((current) => {
      const next = update(current);
      draftRef.current = next;
      return next;
    });
    setDirty(true);
  };
  const draftRevision = saveState.draftRevision ?? catalog?.revision ?? null;
  const publishedRevision =
    publishState.publishedRevision ?? catalog?.basePublishedRevision ?? null;

  return (
    <section className="catalog-section" aria-labelledby="catalog-title">
      <div className="catalog-section__heading">
        <div>
          <p className="eyebrow">Paso 2 de 10</p>
          <h2 id="catalog-title">Carta y productos</h2>
          <p>
            Armá la carta como borrador, revisala a la derecha y publicala
            cuando esté lista.
          </p>
        </div>
        <span
          className={`catalog-status ${dirty ? "catalog-status--dirty" : "catalog-status--saved"}`}
        >
          {dirty ? "Cambios sin guardar" : "Borrador guardado"}
        </span>
      </div>
      <div className="catalog-workspace">
        <div className="catalog-editor">
          <div className="catalog-toolbar" aria-label="Acciones de la carta">
            <button
              className="button button--secondary"
              onClick={() => change(addCatalogCategory)}
              type="button"
            >
              + Agregar categoría
            </button>
            <button
              className="button button--secondary"
              onClick={() => change(addCatalogSector)}
              type="button"
            >
              + Agregar sector
            </button>
            <button
              className="button button--secondary"
              disabled={!draft.categories.length || !draft.sectors.length}
              onClick={() => change(addCatalogProduct)}
              type="button"
            >
              + Agregar producto
            </button>
          </div>

          <div className="catalog-editor__groups">
            <div className="catalog-card">
              <div className="catalog-card__heading">
                <h3>Categorías</h3>
                <span>{draft.categories.length} de 50</span>
              </div>
              {draft.categories.length === 0 ? (
                <p className="catalog-helper">
                  Ejemplo: Entradas, Principales, Postres.
                </p>
              ) : (
                draft.categories.map((category) => (
                  <div className="catalog-inline-row" key={category.id}>
                    <label className="field-group">
                      <span>Nombre</span>
                      <input
                        maxLength={120}
                        onChange={(event) =>
                          change((current) =>
                            localizedUpdate(
                              current,
                              "category",
                              category.id,
                              "title",
                              event.target.value
                            )
                          )
                        }
                        required
                        value={category.content[0]?.title ?? ""}
                      />
                    </label>
                    <button
                      aria-label={`Eliminar ${category.content[0]?.title ?? "categoría"}`}
                      className="catalog-remove"
                      onClick={() =>
                        change((current) =>
                          removeCatalogCategory(current, category.id)
                        )
                      }
                      type="button"
                    >
                      Eliminar
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="catalog-card">
              <div className="catalog-card__heading">
                <h3>Sectores de preparación</h3>
                <span>{draft.sectors.length} de 20</span>
              </div>
              {draft.sectors.length === 0 ? (
                <p className="catalog-helper">
                  Cada producto debe ir a Cocina, Barra u otro sector.
                </p>
              ) : (
                draft.sectors.map((sector) => (
                  <div
                    className="catalog-inline-row catalog-inline-row--sector"
                    key={sector.id}
                  >
                    <label className="field-group">
                      <span>Nombre</span>
                      <input
                        maxLength={80}
                        onChange={(event) =>
                          change((current) => ({
                            ...current,
                            sectors: current.sectors.map((value) =>
                              value.id === sector.id
                                ? { ...value, name: event.target.value }
                                : value
                            )
                          }))
                        }
                        value={sector.name}
                      />
                    </label>
                    <label className="field-group">
                      <span>Tipo</span>
                      <select
                        onChange={(event) =>
                          change((current) => ({
                            ...current,
                            sectors: current.sectors.map((value) =>
                              value.id === sector.id
                                ? {
                                    ...value,
                                    kind: event.target
                                      .value as CatalogSectorKind
                                  }
                                : value
                            )
                          }))
                        }
                        value={sector.kind}
                      >
                        <option value="kitchen">Cocina</option>
                        <option value="bar">Barra</option>
                        <option value="other">Otro</option>
                      </select>
                    </label>
                  </div>
                ))
              )}
            </div>

            <div className="catalog-card catalog-card--products">
              <div className="catalog-card__heading">
                <h3>Productos</h3>
                <span>{draft.products.length} de 500</span>
              </div>
              {draft.products.length === 0 ? (
                <p className="catalog-helper">
                  Agregá categoría y sector antes del primer producto.
                </p>
              ) : (
                draft.products.map((product) => (
                  <article className="catalog-product" key={product.id}>
                    <div className="catalog-product__heading">
                      <strong>
                        {product.content[0]?.title || "Producto sin nombre"}
                      </strong>
                      <button
                        className="catalog-remove"
                        onClick={() =>
                          change((current) =>
                            normalizeProductPositions({
                              ...current,
                              products: current.products.filter(
                                ({ id }) => id !== product.id
                              )
                            })
                          )
                        }
                        type="button"
                      >
                        Eliminar
                      </button>
                    </div>
                    <div className="catalog-product__fields">
                      <label className="field-group">
                        <span>Nombre del producto</span>
                        <input
                          maxLength={120}
                          onChange={(event) =>
                            change((current) =>
                              localizedUpdate(
                                current,
                                "product",
                                product.id,
                                "title",
                                event.target.value
                              )
                            )
                          }
                          value={product.content[0]?.title ?? ""}
                        />
                      </label>
                      <label className="field-group">
                        <span>Precio en pesos</span>
                        <input
                          inputMode="decimal"
                          onChange={(event) => {
                            const cents = parsePriceToCents(event.target.value);
                            if (cents !== null) {
                              change((current) => ({
                                ...current,
                                products: current.products.map((value) =>
                                  value.id === product.id
                                    ? { ...value, priceCents: cents }
                                    : value
                                )
                              }));
                            }
                          }}
                          pattern="[0-9]+(?:,[0-9]{1,2})?"
                          value={formatPrice(product.priceCents)}
                        />
                      </label>
                      <label className="field-group catalog-product__description">
                        <span>Descripción</span>
                        <textarea
                          maxLength={1000}
                          onChange={(event) =>
                            change((current) =>
                              localizedUpdate(
                                current,
                                "product",
                                product.id,
                                "description",
                                event.target.value
                              )
                            )
                          }
                          rows={3}
                          value={product.content[0]?.description ?? ""}
                        />
                      </label>
                      <label className="field-group">
                        <span>Categoría</span>
                        <select
                          onChange={(event) =>
                            change((current) =>
                              normalizeProductPositions({
                                ...current,
                                products: current.products.map((value) =>
                                  value.id === product.id
                                    ? {
                                        ...value,
                                        categoryId: event.target.value
                                      }
                                    : value
                                )
                              })
                            )
                          }
                          value={product.categoryId}
                        >
                          {draft.categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.content[0]?.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field-group">
                        <span>Se prepara en</span>
                        <select
                          onChange={(event) =>
                            change((current) => ({
                              ...current,
                              products: current.products.map((value) =>
                                value.id === product.id
                                  ? { ...value, sectorId: event.target.value }
                                  : value
                              )
                            }))
                          }
                          value={product.sectorId}
                        >
                          {draft.sectors.map((sector) => (
                            <option key={sector.id} value={sector.id}>
                              {sector.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <BusinessMediaUploadField
                      hasAsset={Boolean(product.imageAssetId)}
                      help="Se mostrará junto al producto cuando la carta esté publicada."
                      kind="product"
                      label="Foto del producto"
                      onReady={(imageAssetId) =>
                        change((current) => ({
                          ...current,
                          products: current.products.map((value) =>
                            value.id === product.id
                              ? { ...value, imageAssetId }
                              : value
                          )
                        }))
                      }
                    />
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="catalog-actions">
            <form action={saveAction}>
              <input
                name="catalog"
                type="hidden"
                value={JSON.stringify(draft)}
              />
              <button
                className="button button--primary"
                disabled={saving || !dirty}
                type="submit"
              >
                {saving ? "Guardando…" : "Guardar borrador"}
              </button>
            </form>
            <form action={publishAction}>
              <input
                name="draftRevision"
                type="hidden"
                value={draftRevision ?? ""}
              />
              <button
                className="button button--secondary"
                disabled={publishing || dirty || draftRevision === null}
                type="submit"
              >
                {publishing ? "Publicando…" : "Publicar cambios"}
              </button>
            </form>
          </div>
          {[saveState, publishState].map((state, index) =>
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
        <CatalogPreview draft={draft} publishedRevision={publishedRevision} />
      </div>
    </section>
  );
}
