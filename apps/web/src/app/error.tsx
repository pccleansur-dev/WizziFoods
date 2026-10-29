"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mfa-shell">
      <section className="mfa-card" aria-labelledby="error-title" role="alert">
        <p className="access-step">Algo salió mal</p>
        <h1 id="error-title">No pudimos mostrar esta pantalla</h1>
        <p>
          Fue un problema de nuestro lado, no tuyo. No se perdió ningún dato que
          ya estuviera confirmado. Probá de nuevo en unos segundos.
        </p>
        <button
          className="button button--primary"
          onClick={reset}
          type="button"
        >
          Reintentar
        </button>
      </section>
    </main>
  );
}
