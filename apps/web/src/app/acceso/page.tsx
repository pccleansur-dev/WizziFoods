import Link from "next/link";

import { StaffLoginForm } from "../interno/[tenantSlug]/staff-login-form";
import { LoginForm } from "./login-form";

type AccessParams = {
  "clave-actualizada"?: string;
  error?: string;
  estado?: string;
  local?: string;
  tipo?: string;
};

const notices: Record<string, { status: "error" | "success"; text: string }> = {
  "clave-actualizada": {
    status: "success",
    text: "Contraseña actualizada. Ingresá con tu correo y la nueva clave."
  },
  "enlace-vencido": {
    status: "error",
    text: "El enlace venció o ya fue utilizado. Pedí uno nuevo o usá «¿Olvidaste tu contraseña?»."
  },
  "no-se-pudo-validar": {
    status: "error",
    text: "No pudimos validar tu cuenta. Intentá ingresar nuevamente."
  }
};

export default async function AccessPage({
  searchParams
}: {
  searchParams: Promise<AccessParams>;
}) {
  const params = await searchParams;
  const staff = params.tipo === "equipo";
  const notice =
    params["clave-actualizada"] === "1"
      ? notices["clave-actualizada"]
      : typeof params.error === "string" && Object.hasOwn(notices, params.error)
        ? notices[params.error]
        : undefined;
  const local =
    typeof params.local === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(params.local) &&
    params.local.length <= 80
      ? params.local
      : "";

  return (
    <main className="access-shell">
      <section className="access-context" aria-labelledby="access-title">
        <Link className="platform-wordmark" href="/">
          Wizzi Foods
        </Link>
        <div>
          <h1 id="access-title">Ingresá a tu negocio</h1>
          <p className="access-lead">
            Acceso para administradores y todo el equipo del local.
          </p>
        </div>
      </section>

      <section className="access-card" aria-labelledby="form-title">
        <nav aria-label="Tipo de acceso" className="access-mode">
          <Link
            aria-current={!staff ? "page" : undefined}
            className="button button--secondary"
            href={local ? "/acceso?local=" + local : "/acceso"}
          >
            Administrador
          </Link>
          <Link
            aria-current={staff ? "page" : undefined}
            className="button button--secondary"
            href={
              local
                ? "/acceso?tipo=equipo&local=" + local
                : "/acceso?tipo=equipo"
            }
          >
            Equipo
          </Link>
        </nav>
        <div className="access-card__heading">
          <h2 id="form-title">
            {staff ? "Comenzá tu turno" : "Administrador"}
          </h2>
          <p>
            {staff
              ? "Ingresá con el usuario y PIN que te asignaron en el local."
              : "Después de validar tu cuenta te pediremos el código de tu autenticador."}
          </p>
        </div>
        {notice ? (
          <p
            className={`form-message form-message--${notice.status}`}
            role={notice.status === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        ) : null}
        {staff && params.estado === "no-disponible" ? (
          <p className="form-message form-message--error" role="alert">
            El acceso del equipo no está disponible en este momento. Volvé a
            intentar.
          </p>
        ) : null}
        {staff ? <StaffLoginForm tenantSlug={local} /> : <LoginForm />}
        <p className="access-help">
          {staff
            ? "Si no recordás tu PIN, pedile ayuda al encargado."
            : "¿Todavía no recibiste tu acceso? Contactá al responsable que dio de alta el negocio."}
        </p>
        <nav className="access-legal" aria-label="Información legal">
          <Link href="/Politicas-de-Privacidad">Política de privacidad</Link>
          <Link href="/Condiciones-de-Servicio">Condiciones del servicio</Link>
        </nav>
      </section>
    </main>
  );
}
