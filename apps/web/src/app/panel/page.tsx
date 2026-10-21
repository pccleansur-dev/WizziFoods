import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../auth/load-admin-access";
import { signOutAction } from "./actions";
import { PanelContent } from "./panel-content";

export default async function PanelPage() {
  const result = await loadAdministrativeAccess();

  if (result.status === "unauthenticated") {
    redirect("/acceso/continuar");
  }

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <span className="platform-wordmark">La plataforma</span>
        <form action={signOutAction}>
          <button className="button button--secondary" type="submit">
            Cerrar sesión
          </button>
        </form>
      </header>
      {result.status === "ready" ? (
        <PanelContent administrativeAccess={result.data} />
      ) : (
        <section className="panel-content" role="alert">
          <p className="eyebrow">Servicio temporalmente no disponible</p>
          <h1>No pudimos cargar tu acceso</h1>
          <p className="panel-lead">
            Tu sesión sigue protegida. Esperá un momento y volvé a intentar.
          </p>
        </section>
      )}
    </main>
  );
}
