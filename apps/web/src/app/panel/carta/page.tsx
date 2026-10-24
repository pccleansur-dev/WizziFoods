import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../../auth/load-admin-access";
import { loadBusinessProfileDraft } from "../business-profile";
import { loadCatalogDraft, loadPublishedCatalog } from "../catalog";
import { loadCatalogImports } from "../catalog-import";
import { CartaStep } from "../onboarding/carta-step";
import { OnboardingShell } from "../onboarding/onboarding-shell";

export default async function CatalogPage() {
  const result = await loadAdministrativeAccess();
  if (result.status === "unauthenticated") redirect("/acceso/continuar");

  const context =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? result.data.access.tenantContexts[0]
      : undefined;
  if (!context) {
    return (
      <OnboardingShell current="carta">
        <section className="panel-content" role="alert">
          <p className="eyebrow">Carta</p>
          <h1>No pudimos cargar la carta</h1>
          <p className="panel-lead">
            Esta sección es exclusiva del Administrador del negocio.
          </p>
        </section>
      </OnboardingShell>
    );
  }

  const host = (await headers()).get("host") ?? "";
  const [profile, catalog, published, imports] = await Promise.all([
    loadBusinessProfileDraft(host),
    loadCatalogDraft(host),
    loadPublishedCatalog(host),
    loadCatalogImports(host)
  ]);
  return (
    <OnboardingShell current="carta">
      <CartaStep
        businessProfile={profile.status === "ready" ? profile.data : null}
        catalog={catalog.status === "ready" ? catalog.data : null}
        catalogImports={imports.status === "ready" ? imports.data : []}
        idempotencyKey={randomUUID()}
        publishedCatalog={published.status === "ready" ? published.data : null}
        tenantName={context.tenant.name}
      />
    </OnboardingShell>
  );
}
