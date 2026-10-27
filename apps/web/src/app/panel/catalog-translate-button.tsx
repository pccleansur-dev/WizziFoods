"use client";

import type { CatalogDraft } from "@platform/contracts";
import { useState, useTransition } from "react";

import {
  applyCatalogTranslations,
  approveCatalogTranslations,
  collectMissingTranslations,
  pendingTranslationReviews
} from "./catalog-editor-state";
import { catalogLanguageName } from "./catalog-localized-fields";
import type { TranslateActionState } from "./translate-actions";

/**
 * Completa con traducción automática los textos que faltan en los otros
 * idiomas. Sólo llena campos vacíos y deja el borrador para revisar: nada se
 * publica solo. El estado vive acá para no tocar el del editor.
 */
export function CatalogTranslateButton({
  change,
  draft,
  languages,
  onTranslate
}: {
  change: (update: (current: CatalogDraft) => CatalogDraft) => void;
  draft: CatalogDraft;
  languages: string[];
  onTranslate: (request: unknown) => Promise<TranslateActionState>;
}) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [source, ...targets] = languages;
  if (!source || targets.length === 0) return null;
  const pendingReviews = pendingTranslationReviews(draft);

  function run() {
    startTransition(async () => {
      setMessage("");
      setFailed(false);
      let total = 0;
      const done: string[] = [];
      for (const target of targets) {
        const texts = collectMissingTranslations(draft, source!, target);
        if (texts.length === 0) continue;
        const result = await onTranslate({
          sourceLanguage: source,
          targetLanguage: target,
          texts
        });
        if (result.status !== "ok") {
          setFailed(true);
          setMessage(result.message);
          return;
        }
        change((current) =>
          applyCatalogTranslations(current, target, result.translations)
        );
        total += result.translations.length;
        done.push(catalogLanguageName(target));
      }
      setMessage(
        total === 0
          ? "No falta traducir nada."
          : `Tradujimos ${total} textos (${done.join(", ")}). Revisalos antes de publicar.`
      );
    });
  }

  return (
    <div className="catalog-translate">
      <button
        className="button button--secondary"
        disabled={pending}
        onClick={run}
        type="button"
      >
        {pending ? "Traduciendo…" : "Traducir lo que falta"}
      </button>
      {pendingReviews > 0 ? (
        <div className="catalog-translate__review">
          <p role="status">
            {pendingReviews === 1
              ? "Hay 1 texto con traducción automática sin revisar."
              : `Hay ${pendingReviews} textos con traducción automática sin revisar.`}{" "}
            No se puede publicar hasta que los apruebes; si editás un texto, se
            da por revisado.
          </p>
          <button
            className="button button--secondary"
            onClick={() => {
              change(approveCatalogTranslations);
              setFailed(false);
              setMessage("Aprobaste las traducciones automáticas.");
            }}
            type="button"
          >
            Aprobar las traducciones revisadas
          </button>
        </div>
      ) : null}
      {message ? (
        <p
          className={
            failed
              ? "catalog-translate__message catalog-translate__message--error"
              : "catalog-translate__message"
          }
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
