import { redirect } from "next/navigation";

import { loadStaffSession } from "../../../../../staff/load-staff-session";
import { signOutStaffAction } from "../../actions";
import { MessagingPanel } from "./messaging-panel";

export default async function MessagingPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await loadStaffSession(tenantSlug);
  if (!session.identity.staff.capabilities.includes("operations.approve")) {
    redirect(`/interno/${tenantSlug}/operacion`);
  }

  return (
    <main className="staff-operation-shell">
      <header className="staff-operation-header">
        <div>
          <p className="eyebrow">{session.identity.tenant.name}</p>
          <strong>{session.identity.location.name}</strong>
        </div>
        <nav aria-label="Navegación" className="waiter-header-nav">
          <a
            className="panel-module-link"
            href={`/interno/${tenantSlug}/operacion`}
          >
            Inicio
          </a>
          <form action={signOutStaffAction}>
            <input name="tenantSlug" type="hidden" value={tenantSlug} />
            <button className="button button--secondary" type="submit">
              Cerrar turno
            </button>
          </form>
        </nav>
      </header>
      <div className="waiter-page">
        <h1>Mensajería</h1>
        <MessagingPanel tenantSlug={tenantSlug} />
      </div>
    </main>
  );
}
