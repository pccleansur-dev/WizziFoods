"use client";

import type { BusinessMediaKind } from "@platform/contracts";
import { useId, useState } from "react";

import { uploadBusinessMedia } from "./business-media-upload";

type UploadState = "error" | "idle" | "processing" | "ready" | "uploading";

export function BusinessMediaUploadField({
  currentCount = 0,
  disabled = false,
  hasAsset = false,
  help,
  kind,
  label,
  onReady,
  previewUrl
}: {
  currentCount?: number;
  disabled?: boolean;
  hasAsset?: boolean;
  help: string;
  kind: BusinessMediaKind;
  label: string;
  onReady: (assetId: string, previewUrl?: string) => void;
  /** Miniatura local (blob:) de una imagen ya subida en esta sesión. */
  previewUrl?: string | undefined;
}) {
  const inputId = useId();
  const [message, setMessage] = useState(
    hasAsset ? "Hay una imagen guardada en este borrador." : ""
  );
  const [status, setStatus] = useState<UploadState>(
    hasAsset ? "ready" : "idle"
  );
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const shown = localPreview ?? previewUrl;
  const working = status === "uploading" || status === "processing";

  return (
    <div className="media-upload-field">
      <div>
        <strong>{label}</strong>
        <p>{help}</p>
        {kind === "reference" ? (
          <span className="media-upload-field__count">
            {currentCount} de 12 cargadas
          </span>
        ) : null}
      </div>
      {shown?.startsWith("blob:") ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:)
        <img alt="" className="media-upload-field__thumb" src={shown} />
      ) : null}
      <label
        aria-disabled={disabled || working}
        className="button button--secondary media-upload-field__button"
        htmlFor={inputId}
      >
        {working
          ? "Procesando…"
          : status === "ready" || hasAsset
            ? "Cambiar"
            : "Elegir imagen"}
      </label>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="media-upload-field__input"
        disabled={disabled || working}
        id={inputId}
        multiple={kind === "reference"}
        onChange={async (event) => {
          const chosen = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          // Las fotos de referencia admiten varias a la vez, hasta completar las 12 del borrador.
          const files =
            kind === "reference"
              ? chosen.slice(0, Math.max(0, 12 - currentCount))
              : chosen.slice(0, 1);
          if (files.length === 0) {
            if (chosen.length > 0) {
              setMessage("Ya cargaste las 12 fotos de referencia.");
              setStatus("error");
            }
            return;
          }
          for (const [index, file] of files.entries()) {
            // Miniatura inmediata, antes de que termine la subida. Sólo blob: locales.
            const thumbnail = URL.createObjectURL(file);
            setLocalPreview(thumbnail);
            setMessage(
              files.length > 1
                ? `Subiendo ${index + 1} de ${files.length}: ${file.name}…`
                : `Subiendo ${file.name}…`
            );
            setStatus("uploading");
            try {
              const assetId = await uploadBusinessMedia(file, kind, {
                onStatus: () => {
                  setMessage("Optimizando y verificando la imagen…");
                  setStatus("processing");
                }
              });
              onReady(assetId, thumbnail);
              setMessage(
                files.length > 1
                  ? `${index + 1} de ${files.length} listas para guardar en el borrador.`
                  : "Imagen lista para guardar en el borrador."
              );
              setStatus("ready");
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "No pudimos cargar la imagen."
              );
              setStatus("error");
              URL.revokeObjectURL(thumbnail);
              setLocalPreview(null);
              return;
            }
          }
        }}
        type="file"
      />
      {message ? (
        <p
          className={`media-upload-field__message media-upload-field__message--${status}`}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
