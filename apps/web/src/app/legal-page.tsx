import Link from "next/link";
import type { ReactNode } from "react";

type LegalPageProps = {
  children: ReactNode;
  description: string;
  title: string;
};

export function LegalPage({ children, description, title }: LegalPageProps) {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="platform-wordmark" href="/">
          Wizzi Foods
        </Link>
        <p className="eyebrow">Información legal</p>
        <h1>{title}</h1>
        <p className="legal-lead">{description}</p>
        <p className="legal-updated">Vigente desde el 28 de octubre de 2026</p>
      </header>

      <article className="legal-document">{children}</article>

      <nav className="legal-navigation" aria-label="Documentos legales">
        <Link href="/Politicas-de-Privacidad">Política de privacidad</Link>
        <Link href="/Condiciones-de-Servicio">Condiciones del servicio</Link>
        <Link href="/acceso">Volver al acceso</Link>
      </nav>
    </main>
  );
}
