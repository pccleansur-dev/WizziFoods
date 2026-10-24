"use client";

import type { CatalogDraft, CatalogSectorKind } from "@platform/contracts";
import { useActionState, useRef, useState } from "react";

import { publishCatalogAction, saveCatalogAction } from "./actions";
import type { CatalogActionState } from "./catalog-action-state";
import {
  addCatalogCategory,
  addCatalogProduct,
  addCatalogSector,
  addCatalogVariant,
  createEmptyCatalogDraft,
  formatPrice,
  normalizeProductPositions,
  parsePriceToCents,
  removeCatalogCategory,
  removeCatalogVariant,
  synchronizeCatalogLanguages,
  updateCatalogLocalizedContent
} from "./catalog-editor-state";
import {
  CatalogLocalizedFields,
  catalogLanguageName
} from "./catalog-localized-fields";
import { CatalogPreview } from "./catalog-preview";
import type { PublishedCatalog, SavedCatalogDraft } from "./catalog";
import { BusinessMediaUploadField } from "./business-media-upload-field";
import { CatalogAvailabilityControl } from "./catalog-availability";
import {
  CatalogPublicationReadiness,
  catalogIsReadyToPublish
} from "./catalog-publication-readiness";

const initialActionState = (
  catalog: SavedCatalogDraft | null
): CatalogActionState => ({
  draftRevision: catalog?.revision ?? null,
  message: "",
  publishedRevision: catalog?.basePublishedRevision ?? null,
  status: "idle"
});

export function CatalogEditor({
  catalog,
  hasBusinessProfile,
  languages,
  publishedCatalog
}: {
  catalog: SavedCatalogDraft | null;
  hasBusinessProfile: boolean;
  languages: string[];
  publishedCatalog: PublishedCatalog | null;
}) {
  const initialDraft = synchronizeCatalogLanguages(
    catalog?.draft ?? createEmptyCatalogDraft(),
    languages
  );
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const [previewLanguage, setPreviewLanguage] = useState(languages[0] ?? "es");
  const [dirty, setDirty] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
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
  const readyToPublish = catalogIsReadyToPublish(
    draft,
    languages,
    hasBusinessProfile
  );

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
              onClick={() =>
                change((current) =>
                  addCatalogCategory(current, undefined, languages)
                )
              }
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
              onClick={() =>
                change((current) =>
                  addCatalogProduct(current, undefined, languages)
                )
              }
              type="button"
            >
              + Agregar producto
            </button>
            <label className="catalog-language-picker">
              <span>Idioma de vista previa</span>
              <select
                onChange={(event) => setPreviewLanguage(event.target.value)}
                value={previewLanguage}
              >
                {languages.map((language) => (
                  <option key={language} value={language}>
                    {catalogLanguageName(language)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="catalog-language-note">
            <strong>Contenido por idioma.</strong> Nombre y descripción se
            publican por separado; precio, imagen y disponibilidad se comparten.
          </p>

          <div className="catalog-editor__groups">
            <div className="catalog-card catalog-card--table">
              <div className="catalog-card__heading">
                <h3>Categorías</h3>
                <span>{draft.categories.length} de 50</span>
              </div>
              {draft.categories.length === 0 ? (
                <p className="catalog-helper">
                  Ejemplo: Entradas, Principales, Postres.
                </p>
              ) : (
                <>
                  <div
                    aria-hidden="true"
                    className="catalog-table-head catalog-table-head--categories"
                  >
                    <span>Nombre</span>
                    <span>Descripción</span>
                    <span />
                  </div>
                  {draft.categories.map((category) => (
                    <div
                      className="catalog-inline-row catalog-inline-row--category"
                      key={category.id}
                    >
                      <CatalogLocalizedFields
                        content={category.content}
                        languages={languages}
                        legend="Contenido de la categoría"
                        onChange={(language, field, value) =>
                          change((current) =>
                            updateCatalogLocalizedContent(
                              current,
                              { id: category.id, type: "category" },
                              language,
                              field,
                              value
                            )
                          )
                        }
                      />
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
                  ))}
                </>
              )}
            </div>

            <div className="catalog-card catalog-card--table">
              <div className="catalog-card__heading">
                <h3>Sectores de preparación</h3>
                <span>{draft.sectors.length} de 20</span>
              </div>
              {draft.sectors.length === 0 ? (
                <p className="catalog-helper">
                  Cada producto debe ir a Cocina, Barra u otro sector.
                </p>
              ) : (
                <>
                  <div
                    aria-hidden="true"
                    className="catalog-table-head catalog-table-head--sectors"
                  >
                    <span>Nombre</span>
                    <span>Tipo</span>
                  </div>
                  {draft.sectors.map((sector) => (
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
                  ))}
                </>
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
                <>
                  <div aria-hidden="true" className="catalog-table-head">
                    <span>Nombre</span>
                    <span>Descripción</span>
                    <span>Precio ($)</span>
                    <span>Categoría</span>
                    <span>Se prepara en</span>
                    <span>Foto</span>
                    <span />
                  </div>
                  {draft.products.map((product) => (
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
                          <span>Precio en pesos</span>
                          <input
                            inputMode="decimal"
                            onChange={(event) => {
                              const cents = parsePriceToCents(
                                event.target.value
                              );
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
                      <CatalogLocalizedFields
                        content={product.content}
                        languages={languages}
                        legend="Contenido del producto"
                        onChange={(language, field, value) =>
                          change((current) =>
                            updateCatalogLocalizedContent(
                              current,
                              { id: product.id, type: "product" },
                              language,
                              field,
                              value
                            )
                          )
                        }
                      />
                      <BusinessMediaUploadField
                        hasAsset={Boolean(product.imageAssetId)}
                        help="Se mostrará junto al producto cuando la carta esté publicada."
                        kind="product"
                        label="Foto del producto"
                        onReady={(imageAssetId, thumbnail) => {
                          if (thumbnail) {
                            setPreviews((current) => ({
                              ...current,
                              [imageAssetId]: thumbnail
                            }));
                          }
                          change((current) => ({
                            ...current,
                            products: current.products.map((value) =>
                              value.id === product.id
                                ? { ...value, imageAssetId }
                                : value
                            )
                          }));
                        }}
                        previewUrl={
                          product.imageAssetId
                            ? previews[product.imageAssetId]
                            : undefined
                        }
                      />
                      <div className="catalog-variants">
                        <div className="catalog-card__heading">
                          <div>
                            <h4>Variantes</h4>
                            <p>
                              Ejemplo: tamaño, presentación o acompañamiento.
                            </p>
                          </div>
                          <button
                            className="button button--secondary"
                            disabled={product.variants.length >= 30}
                            onClick={() =>
                              change((current) =>
                                addCatalogVariant(
                                  current,
                                  product.id,
                                  undefined,
                                  languages
                                )
                              )
                            }
                            type="button"
                          >
                            + Agregar variante
                          </button>
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
                                    removeCatalogVariant(
                                      current,
                                      product.id,
                                      variant.id
                                    )
                                  )
                                }
                                type="button"
                              >
                                Eliminar variante
                              </button>
                            </div>
                            <label className="field-group catalog-variant__price">
                              <span>Adicional en pesos</span>
                              <input
                                inputMode="decimal"
                                onChange={(event) => {
                                  const cents = parsePriceToCents(
                                    event.target.value
                                  );
                                  if (cents !== null) {
                                    change((current) => ({
                                      ...current,
                                      products: current.products.map((value) =>
                                        value.id === product.id
                                          ? {
                                              ...value,
                                              variants: value.variants.map(
                                                (item) =>
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
                    </article>
                  ))}
                </>
              )}
            </div>
          </div>

          <CatalogPublicationReadiness
            draft={draft}
            hasBusinessProfile={hasBusinessProfile}
            languages={languages}
          />
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
                disabled={
                  publishing ||
                  dirty ||
                  draftRevision === null ||
                  !readyToPublish
                }
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
        <CatalogPreview
          draft={draft}
          language={previewLanguage}
          previews={previews}
          publishedRevision={publishedRevision}
        />
      </div>
      <div
        className="catalog-availability"
        aria-labelledby="availability-title"
      >
        <div className="catalog-card__heading">
          <div>
            <h3 id="availability-title">Disponibilidad inmediata</h3>
            <p>
              Estos cambios impactan ahora en la carta publicada y no publican
              el resto del borrador.
            </p>
          </div>
          <span>Versión publicada</span>
        </div>
        {publishedCatalog?.catalog.products.length ? (
          publishedCatalog.catalog.products.map((product) => (
            <CatalogAvailabilityControl
              initialAvailability={publishedCatalog.availability[product.id]}
              key={product.id}
              productId={product.id}
              productTitle={product.content[0]?.title ?? "Producto sin nombre"}
            />
          ))
        ) : (
          <p className="catalog-helper">
            Publicá la primera versión para administrar disponibilidad.
          </p>
        )}
      </div>
    </section>
  );
}
