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
  onReady
}: {
  currentCount?: number;
  disabled?: boolean;
  hasAsset?: boolean;
  help: string;
  kind: BusinessMediaKind;
  label: string;
  onReady: (assetId: string) => void;
}) {
  const inputId = useId();
  const [message, setMessage] = useState(
    hasAsset ? "Hay una imagen guardada en este borrador." : ""
  );
  const [status, setStatus] = useState<UploadState>(
    hasAsset ? "ready" : "idle"
  );
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
      <label
        aria-disabled={disabled || working}
        className="button button--secondary media-upload-field__button"
        htmlFor={inputId}
      >
        {working ? "Procesando…" : "Elegir imagen"}
      </label>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="media-upload-field__input"
        disabled={disabled || working}
        id={inputId}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          setMessage(`Subiendo ${file.name}…`);
          setStatus("uploading");
          try {
            const assetId = await uploadBusinessMedia(file, kind, {
              onStatus: () => {
                setMessage("Optimizando y verificando la imagen…");
                setStatus("processing");
              }
            });
            onReady(assetId);
            setMessage("Imagen lista para guardar en el borrador.");
            setStatus("ready");
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "No pudimos cargar la imagen."
            );
            setStatus("error");
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
