import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../../auth/load-admin-access";
import { readinessCommandAction } from "./actions";
import { loadReadiness } from "./readiness";
import { ReadinessManager } from "./readiness-manager";
import { OnboardingShell } from "../onboarding/onboarding-shell";

export default async function PublishBusinessPage() {
  const result = await loadAdministrativeAccess();
  if (result.status === "unauthenticated") redirect("/acceso/continuar");

  const isTenantAdmin =
    result.status === "ready" && result.data.access.type === "tenant_admin";
  const readiness = isTenantAdmin ? await loadReadiness() : null;

  return (
    <OnboardingShell current="publicar">
      {readiness?.status === "ready" ? (
        <ReadinessManager
          initialReadiness={readiness.readiness}
          onCommand={readinessCommandAction}
        />
      ) : (
        <section className="panel-content" role="alert">
          <p className="eyebrow">Publicación</p>
          <h1>No pudimos cargar los requisitos</h1>
          <p className="panel-lead">
            {isTenantAdmin
              ? "Tu sesión sigue protegida. Esperá un momento y volvé a intentar."
              : "Esta sección es exclusiva del Administrador del negocio."}
          </p>
        </section>
      )}
    </OnboardingShell>
  );
}
