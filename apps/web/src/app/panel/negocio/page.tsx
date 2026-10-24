import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../../auth/load-admin-access";
import { loadBusinessProfileDraft } from "../business-profile";
import { BusinessStep } from "../onboarding/business-step";
import { OnboardingShell } from "../onboarding/onboarding-shell";

export default async function BusinessPage() {
  const result = await loadAdministrativeAccess();
  if (result.status === "unauthenticated") redirect("/acceso/continuar");

  const context =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? result.data.access.tenantContexts[0]
      : undefined;
  if (!context) {
    return (
      <OnboardingShell current="negocio">
        <section className="panel-content" role="alert">
          <p className="eyebrow">Negocio</p>
          <h1>No pudimos cargar los datos del negocio</h1>
          <p className="panel-lead">
            Esta sección es exclusiva del Administrador del negocio.
          </p>
        </section>
      </OnboardingShell>
    );
  }

  const profile = await loadBusinessProfileDraft(
    (await headers()).get("host") ?? ""
  );
  return (
    <OnboardingShell current="negocio">
      <BusinessStep
        businessProfile={profile.status === "ready" ? profile.data : null}
        tenantName={context.tenant.name}
      />
    </OnboardingShell>
  );
}
