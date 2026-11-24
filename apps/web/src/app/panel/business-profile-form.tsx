"use client";

import type { BusinessProfileDraft } from "@platform/contracts";
import { useActionState, useId, useState, type ReactNode } from "react";

import { saveBusinessProfileAction } from "./actions";
import type { BusinessProfileActionState } from "./business-profile-state";
import { contrastRatio, readableTextColor } from "./color-contrast";
import { BusinessMediaUploadField } from "./business-media-upload-field";

const sections = [
  { id: "datos", label: "Datos del local" },
  { id: "identidad", label: "Imagen y estilo" },
  { id: "horarios", label: "Horarios de pedidos" },
  { id: "resenas", label: "Reseñas de Google" }
] as const;

export function BusinessProfileForm({
  draft,
  hoursPanel,
  reviewPanel
}: {
  draft: BusinessProfileDraft;
  hoursPanel?: ReactNode;
  reviewPanel?: ReactNode;
}) {
  const id = useId();
  const [tab, setTab] = useState<(typeof sections)[number]["id"]>("datos");
  const tabbed = hoursPanel !== undefined && reviewPanel !== undefined;
  const profileVisible = !tabbed || tab === "datos" || tab === "identidad";
  const [preview, setPreview] = useState(draft);
  const [media, setMedia] = useState({
    coverAssetId: draft.coverAssetId,
    logoAssetId: draft.logoAssetId,
    referenceAssetIds: draft.referenceAssetIds
  });
  const initialState: BusinessProfileActionState = {
    message: "",
    status: "idle"
  };
  const [state, formAction, pending] = useActionState(
    saveBusinessProfileAction,
    initialState
  );
  const textContrast = contrastRatio(
    preview.visual.primaryColor,
    preview.visual.secondaryColor
  );

  return (
    <div className={tabbed ? "business-settings" : undefined}>
      {tabbed ? (
        <>
          <h1>Negocio</h1>
          <div
            aria-label="Configuración del negocio"
            className="business-settings__tabs"
            role="tablist"
          >
            {sections.map(({ id: key, label }, index) => (
              <button
                aria-controls={id + "-" + key}
                aria-selected={tab === key}
                className="button button--secondary"
                id={id + "-tab-" + key}
                key={key}
                role="tab"
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(event) => {
                  const step =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  if (!step && event.key !== "Home" && event.key !== "End")
                    return;
                  event.preventDefault();
                  const target =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? sections.length - 1
                        : (index + step + sections.length) % sections.length;
                  const next = sections[target]!.id;
                  setTab(next);
                  document.getElementById(id + "-tab-" + next)?.focus();
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="profile-workspace" hidden={!profileVisible}>
        <form
          action={formAction}
          className="profile-form"
          onInvalidCapture={() => {
            if (tabbed && tab === "identidad") setTab("datos");
          }}
          onChange={(event) => {
            const data = new FormData(event.currentTarget);
            const selectedLayout = data.get("layout");
            setPreview((current) => ({
              ...current,
              description: String(data.get("description") ?? ""),
              displayName: String(data.get("displayName") ?? ""),
              visual: {
                ...current.visual,
                accentColor: String(data.get("accentColor") ?? "#D97706"),
                headingStyle:
                  data.get("headingStyle") === "sans" ? "sans" : "serif",
                layout:
                  selectedLayout === "compact" || selectedLayout === "modern"
                    ? selectedLayout
                    : "visual",
                primaryColor: String(data.get("primaryColor") ?? "#1F2937"),
                secondaryColor: String(data.get("secondaryColor") ?? "#F9FAFB")
              }
            }));
          }}
        >
          <div
            aria-labelledby={tabbed ? id + "-tab-datos" : undefined}
            hidden={tabbed && tab !== "datos"}
            id={tabbed ? id + "-datos" : undefined}
            role={tabbed ? "tabpanel" : undefined}
          >
            <div className="profile-section-heading">
              <h2>{tabbed ? "Datos del local" : "Datos e identidad"}</h2>
            </div>
            <div className="profile-fields-grid">
              <label className="field-group">
                <span>Nombre visible</span>
                <input
                  defaultValue={draft.displayName}
                  maxLength={120}
                  name="displayName"
                  required
                />
              </label>
              <label className="field-group">
                <span>Teléfono de contacto</span>
                <input
                  autoComplete="tel"
                  defaultValue={draft.contactPhone}
                  maxLength={40}
                  name="contactPhone"
                />
              </label>
              <label className="field-group profile-field--wide">
                <span>Descripción</span>
                <textarea
                  defaultValue={draft.description}
                  maxLength={1000}
                  name="description"
                  rows={4}
                />
              </label>
              <label className="field-group profile-field--wide">
                <span>Dirección</span>
                <input
                  autoComplete="street-address"
                  defaultValue={draft.address}
                  maxLength={300}
                  name="address"
                />
              </label>
              <label className="field-group profile-field--wide">
                <span>Horarios</span>
                <textarea
                  defaultValue={draft.openingHours}
                  maxLength={500}
                  name="openingHours"
                  rows={3}
                />
              </label>
            </div>
            <fieldset className="profile-options">
              <legend>Idiomas</legend>
              <label>
                <input
                  defaultChecked={draft.languages.includes("es")}
                  name="languages"
                  type="checkbox"
                  value="es"
                />{" "}
                Español
              </label>
              <label>
                <input
                  defaultChecked={draft.languages.includes("en")}
                  name="languages"
                  type="checkbox"
                  value="en"
                />{" "}
                Inglés
              </label>
            </fieldset>
          </div>
          <div
            aria-labelledby={tabbed ? id + "-tab-identidad" : undefined}
            hidden={tabbed && tab !== "identidad"}
            id={tabbed ? id + "-identidad" : undefined}
            role={tabbed ? "tabpanel" : undefined}
          >
            <section
              className="profile-media"
              aria-labelledby="profile-media-title"
            >
              <div>
                <h3 id="profile-media-title">Imágenes del negocio</h3>
                <p>
                  Se comprimen y verifican antes de sumarse al borrador. JPG,
                  PNG o WebP, hasta 12 MB por archivo.
                </p>
              </div>
              <BusinessMediaUploadField
                help="Se usa en la cabecera, el acceso y los comprobantes visuales."
                hasAsset={Boolean(media.logoAssetId)}
                kind="logo"
                label="Logo del negocio"
                onReady={(logoAssetId) =>
                  setMedia((current) => ({ ...current, logoAssetId }))
                }
              />
              <BusinessMediaUploadField
                help="Acompaña la bienvenida y la vista principal de la carta."
                hasAsset={Boolean(media.coverAssetId)}
                kind="cover"
                label="Imagen de portada"
                onReady={(coverAssetId) =>
                  setMedia((current) => ({ ...current, coverAssetId }))
                }
              />
              <BusinessMediaUploadField
                currentCount={media.referenceAssetIds.length}
                disabled={media.referenceAssetIds.length >= 12}
                help="Fotos del local, platos o cartas actuales para orientar la propuesta visual."
                kind="reference"
                label="Fotos de referencia"
                onReady={(assetId) =>
                  setMedia((current) => ({
                    ...current,
                    referenceAssetIds: [
                      ...new Set([...current.referenceAssetIds, assetId])
                    ]
                  }))
                }
              />
            </section>
            <fieldset className="profile-options">
              <legend>Composición</legend>
              {(["visual", "compact", "modern"] as const).map((layout) => (
                <label key={layout}>
                  <input
                    defaultChecked={draft.visual.layout === layout}
                    name="layout"
                    type="radio"
                    value={layout}
                  />{" "}
                  {layout === "visual"
                    ? "Visual"
                    : layout === "compact"
                      ? "Compacta"
                      : "Moderna"}
                </label>
              ))}
            </fieldset>
            <div className="profile-color-grid">
              <label>
                Principal
                <input
                  defaultValue={draft.visual.primaryColor}
                  name="primaryColor"
                  type="color"
                />
              </label>
              <label>
                Fondo
                <input
                  defaultValue={draft.visual.secondaryColor}
                  name="secondaryColor"
                  type="color"
                />
              </label>
              <label>
                Acento
                <input
                  defaultValue={draft.visual.accentColor}
                  name="accentColor"
                  type="color"
                />
              </label>
            </div>
            <label className="field-group">
              <span>Estilo de títulos</span>
              <select
                defaultValue={draft.visual.headingStyle}
                name="headingStyle"
              >
                <option value="serif">Con personalidad</option>
                <option value="sans">Simple y contemporáneo</option>
              </select>
            </label>
          </div>
          <input
            name="logoAssetId"
            type="hidden"
            value={media.logoAssetId ?? ""}
          />
          <input
            name="coverAssetId"
            type="hidden"
            value={media.coverAssetId ?? ""}
          />
          {media.referenceAssetIds.map((id) => (
            <input key={id} name="referenceAssetIds" type="hidden" value={id} />
          ))}
          <button
            className="button button--primary"
            disabled={pending}
            type="submit"
          >
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
          {state.message ? (
            <p
              className={`form-message form-message--${state.status}`}
              role="status"
            >
              {state.message}
            </p>
          ) : null}
        </form>
        <aside
          className="profile-preview"
          aria-label="Vista previa del borrador"
          hidden={tabbed && tab !== "identidad"}
        >
          <div className="profile-preview__status">
            Vista previa · no publicado
          </div>
          <div
            className={`profile-preview__surface profile-preview__surface--${preview.visual.layout}`}
            style={{
              backgroundColor: preview.visual.secondaryColor,
              color: preview.visual.primaryColor
            }}
          >
            <span
              style={{
                borderBottom: `3px solid ${preview.visual.accentColor}`,
                paddingBottom: "0.2rem"
              }}
            >
              Carta del restaurante
            </span>
            <h3
              className={
                preview.visual.headingStyle === "serif"
                  ? "preview-heading--serif"
                  : ""
              }
            >
              {preview.displayName || "Nombre del negocio"}
            </h3>
            <p>
              {preview.description ||
                "Agregá una descripción para anticipar la experiencia del lugar."}
            </p>
            <button
              style={{
                backgroundColor: preview.visual.accentColor,
                color: readableTextColor(preview.visual.accentColor)
              }}
              type="button"
            >
              Ver la carta
            </button>
          </div>
          {textContrast < 4.5 ? (
            <p className="profile-contrast-warning" role="alert">
              El contraste entre texto y fondo es {textContrast}:1. Ajustá los
              colores hasta alcanzar al menos 4.5:1.
            </p>
          ) : (
            <p className="profile-contrast-ok" role="status">
              Contraste de texto aprobado: {textContrast}:1.
            </p>
          )}
        </aside>
      </div>
      {tabbed ? (
        <>
          <div
            aria-labelledby={id + "-tab-horarios"}
            className="business-settings__panel"
            hidden={tab !== "horarios"}
            id={id + "-horarios"}
            role="tabpanel"
          >
            {hoursPanel}
          </div>
          <div
            aria-labelledby={id + "-tab-resenas"}
            className="business-settings__panel"
            hidden={tab !== "resenas"}
            id={id + "-resenas"}
            role="tabpanel"
          >
            {reviewPanel}
          </div>
        </>
      ) : null}
    </div>
  );
}
