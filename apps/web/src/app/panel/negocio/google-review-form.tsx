"use client";

import { startTransition, useActionState, useState } from "react";
import { saveGoogleReviewLink } from "./google-review-actions";

export function GoogleReviewForm({ url }: { url: string | null }) {
  const [draft, setDraft] = useState(url ?? "");
  const [{ url: publishedUrl, message }, save, pending] = useActionState(
    saveGoogleReviewLink,
    { url, message: "" }
  );
  return (
    <details className="profile-form google-review-settings">
      <summary>
        <strong>Reseñas de Google</strong>{" "}
        <span className="status-pill">
          {publishedUrl ? "Publicado" : "Sin enlace publicado"}
        </span>
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(() => save(draft));
        }}
      >
        <label className="field-group">
          Enlace para dejar una reseña
          <input
            type="url"
            autoComplete="off"
            maxLength={1024}
            placeholder="https://g.page/r/…/review"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <p>Para quitar el botón de la carta, dejá el campo vacío y guardá.</p>
        <button
          type="submit"
          className="button button--primary"
          disabled={pending}
        >
          {pending ? "Guardando…" : "Guardar enlace"}
        </button>
        {message ? <p role="status">{message}</p> : null}
      </form>
    </details>
  );
}
