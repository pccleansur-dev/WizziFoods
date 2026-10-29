import Link from "next/link";

export const metadata = { title: "No encontramos la página" };

export default function NotFound() {
  return (
    <main className="mfa-shell">
      <section className="mfa-card" aria-labelledby="not-found-title">
        <p className="access-step">Error 404</p>
        <h1 id="not-found-title">No encontramos esta página</h1>
        <p>
          El enlace puede estar mal escrito o ya no existir. Si llegaste desde
          un QR, pedile ayuda al personal del local.
        </p>
        <Link className="button button--primary" href="/acceso">
          Ir al ingreso
        </Link>
      </section>
    </main>
  );
}
