"use client";

import { useActionState, useState } from "react";
import { saveGoogleReviewLink } from "./google-review-actions";

export function GoogleReviewForm({ url }: { url: string | null }) {
  const [draft, setDraft] = useState(url ?? "");
  const [{ url: publishedUrl, message }, save, pending] = useActionState(
    saveGoogleReviewLink,
    { url, message: "" }
  );
  return (
    <section
      className="profile-form google-review-settings"
      aria-labelledby="google-review-title"
    >
      <header>
        <h2 id="google-review-title">Reseñas de Google</h2>{" "}
        <span className="status-pill">
          {publishedUrl ? "Publicado" : "Sin enlace publicado"}
        </span>
      </header>
      <form action={save} noValidate>
        <label className="field-group">
          Enlace para dejar una reseña
          <input
            name="reviewUrl"
            type="url"
            autoComplete="off"
            maxLength={1024}
            placeholder="https://g.page/r/…/review"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {message ? <p role="status">{message}</p> : null}
        <p>Para quitar el botón de la carta, dejá el campo vacío y guardá.</p>
        <button
          type="submit"
          className="button button--primary"
          disabled={pending}
        >
          {pending ? "Guardando…" : "Guardar enlace"}
        </button>
      </form>
    </section>
  );
}
