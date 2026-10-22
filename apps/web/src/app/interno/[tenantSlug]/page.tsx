import { notFound } from "next/navigation";

import { staffSessionCookieName } from "../../../staff/staff-access";
import { StaffLoginForm } from "./staff-login-form";

export default async function StaffAccessPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  try {
    staffSessionCookieName(tenantSlug);
  } catch {
    notFound();
  }

  return (
    <main className="staff-access-shell">
      <section
        className="staff-access-card"
        aria-labelledby="staff-access-title"
      >
        <div className="staff-access-brand" aria-hidden="true">
          LP
        </div>
        <p className="access-step">Acceso interno</p>
        <h1 id="staff-access-title">Comenzá tu turno</h1>
        <p className="staff-access-lead">
          Ingresá con el usuario y PIN que te asignó el administrador del
          negocio.
        </p>
        <StaffLoginForm tenantSlug={tenantSlug} />
        <p className="access-help">
          Si tu cuenta está bloqueada o no recordás el PIN, pedile ayuda a un
          encargado.
        </p>
      </section>
    </main>
  );
}
