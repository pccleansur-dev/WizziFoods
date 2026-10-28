import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../auth/load-admin-access";
import { signOutAction } from "./actions";
import { onboardingProgress } from "./onboarding/steps";
import { PanelContent } from "./panel-content";
import { loadReadiness } from "./publicar/readiness";
import { loadPlatformOperations } from "./platform-operations";

export default async function PanelPage() {
  const result = await loadAdministrativeAccess();

  if (result.status === "unauthenticated") {
    redirect("/acceso/continuar");
  }

  const platformOperations =
    result.status === "ready" &&
    result.data.access.type === "platform_superadmin"
      ? await loadPlatformOperations()
      : null;
  const onboarding =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? await loadReadiness()
      : null;

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <span className="platform-wordmark">Wizzi Foods</span>
        <form action={signOutAction}>
          <button className="button button--secondary" type="submit">
            Cerrar sesión
          </button>
        </form>
      </header>
      {result.status === "ready" ? (
        <PanelContent
          administrativeAccess={result.data}
          platformOperations={
            platformOperations?.status === "ready"
              ? platformOperations.data
              : null
          }
          onboarding={onboardingProgress(
            onboarding?.status === "ready" ? onboarding.readiness : null
          )}
        />
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
