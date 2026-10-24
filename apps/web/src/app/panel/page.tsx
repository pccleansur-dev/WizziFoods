import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { loadAdministrativeAccess } from "../../auth/load-admin-access";
import { signOutAction } from "./actions";
import { PanelContent } from "./panel-content";
import { loadPlatformOperations } from "./platform-operations";
import { loadBusinessProfileDraft } from "./business-profile";
import { loadCatalogDraft, loadPublishedCatalog } from "./catalog";
import { loadCatalogImports } from "./catalog-import";

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
  const tenantHost = (await headers()).get("host") ?? "";
  const businessProfile =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? await loadBusinessProfileDraft(tenantHost)
      : null;
  const catalog =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? await loadCatalogDraft(tenantHost)
      : null;
  const publishedCatalog =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? await loadPublishedCatalog(tenantHost)
      : null;
  const catalogImports =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? await loadCatalogImports(tenantHost)
      : null;

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
        <PanelContent
          administrativeAccess={result.data}
          platformOperations={
            platformOperations?.status === "ready"
              ? platformOperations.data
              : null
          }
          businessProfile={
            businessProfile?.status === "ready" ? businessProfile.data : null
          }
          catalog={catalog?.status === "ready" ? catalog.data : null}
          catalogImports={
            catalogImports?.status === "ready" ? catalogImports.data : []
          }
          publishedCatalog={
            publishedCatalog?.status === "ready" ? publishedCatalog.data : null
          }
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
