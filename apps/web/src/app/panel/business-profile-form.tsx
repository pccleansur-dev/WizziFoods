"use client";

import type { BusinessProfileDraft } from "@platform/contracts";
import { useActionState, useState } from "react";

import { saveBusinessProfileAction } from "./actions";
import type { BusinessProfileActionState } from "./business-profile-state";
import { contrastRatio, readableTextColor } from "./color-contrast";

export function BusinessProfileForm({
  draft
}: {
  draft: BusinessProfileDraft;
}) {
  const [preview, setPreview] = useState(draft);
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
    <div className="profile-workspace">
      <form
        action={formAction}
        className="profile-form"
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
        <div className="profile-section-heading">
          <p className="eyebrow">Paso 1 de 10</p>
          <h2>Datos e identidad</h2>
          <p>
            Guardá el avance cuando quieras. Esto todavía no modifica lo
            publicado.
          </p>
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
          <select defaultValue={draft.visual.headingStyle} name="headingStyle">
            <option value="serif">Con personalidad</option>
            <option value="sans">Simple y contemporáneo</option>
          </select>
        </label>
        <input
          name="logoAssetId"
          type="hidden"
          value={draft.logoAssetId ?? ""}
        />
        <input
          name="coverAssetId"
          type="hidden"
          value={draft.coverAssetId ?? ""}
        />
        {draft.referenceAssetIds.map((id) => (
          <input key={id} name="referenceAssetIds" type="hidden" value={id} />
        ))}
        <button
          className="button button--primary"
          disabled={pending}
          type="submit"
        >
          {pending ? "Guardando…" : "Guardar y continuar después"}
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
      <aside className="profile-preview" aria-label="Vista previa del borrador">
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
          <span style={{ color: preview.visual.accentColor }}>
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
  );
}
