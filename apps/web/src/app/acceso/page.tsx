import Link from "next/link";

import { LoginForm } from "./login-form";

export default function AccessPage() {
  return (
    <main className="access-shell">
      <section className="access-context" aria-labelledby="access-title">
        <Link className="platform-wordmark" href="/">
          Wizzi Foods
        </Link>
        <div>
          <p className="eyebrow">Administración del negocio</p>
          <h1 id="access-title">Ingresá a tu negocio</h1>
          <p className="access-lead">
            Gestioná carta, salón, equipo y operación desde un único lugar. Cada
            negocio mantiene sus datos y accesos separados.
          </p>
        </div>
        <p className="access-support">
          El personal del salón ingresa desde el acceso interno con su usuario y
          PIN.
        </p>
      </section>

      <section className="access-card" aria-labelledby="form-title">
        <div className="access-card__heading">
          <p className="access-step">Acceso seguro</p>
          <h2 id="form-title">Administrador</h2>
          <p>
            Después de validar tu cuenta te pediremos el código de tu
            autenticador.
          </p>
        </div>
        <LoginForm />
        <p className="access-help">
          ¿Todavía no recibiste tu acceso? Contactá al responsable que dio de
          alta el negocio.
        </p>
        <nav className="access-legal" aria-label="Información legal">
          <Link href="/Politicas-de-Privacidad">Política de privacidad</Link>
          <Link href="/Condiciones-de-Servicio">Condiciones del servicio</Link>
        </nav>
      </section>
    </main>
  );
}
