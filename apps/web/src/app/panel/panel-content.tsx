import { randomUUID } from "node:crypto";

import type { AdministrativeAccess } from "../../auth/admin-access";
import type { PlatformOperations } from "./platform-operations";
import { PlatformOperationsPanel } from "./platform-operations-panel";
import { TenantProvisioningForm } from "./tenant-provisioning-form";
import { BusinessProfileForm } from "./business-profile-form";
import type { SavedBusinessProfileDraft } from "./business-profile";
import { CatalogEditor } from "./catalog-editor";
import type { PublishedCatalog, SavedCatalogDraft } from "./catalog";

export function PanelContent({
  administrativeAccess,
  businessProfile = null,
  catalog = null,
  publishedCatalog = null,
  platformOperations = null
}: {
  administrativeAccess: AdministrativeAccess;
  businessProfile?: SavedBusinessProfileDraft | null;
  catalog?: SavedCatalogDraft | null;
  publishedCatalog?: PublishedCatalog | null;
  platformOperations?: PlatformOperations | null;
}) {
  const { access } = administrativeAccess;

  if (access.type === "platform_superadmin") {
    return (
      <div className="panel-content panel-content--superadmin">
        <div className="provisioning-workspace">
          <div className="provisioning-intro">
            <p className="eyebrow">Superadmin</p>
            <h1>Crear y entregar negocios</h1>
            <p className="panel-lead">
              Creá el espacio aislado del cliente y enviá el acceso inicial a su
              administrador. El negocio queda en borrador hasta completar su
              configuración.
            </p>
            <ol className="provisioning-summary">
              <li>Se crea el negocio con su ubicación principal.</li>
              <li>El administrador recibe un enlace de un solo uso.</li>
              <li>
                Al ingresar, continúa con el asistente de personalización.
              </li>
            </ol>
          </div>
          <div className="provisioning-card">
            <div>
              <p className="eyebrow">Alta inicial</p>
              <h2>Datos para la invitación</h2>
            </div>
            <TenantProvisioningForm idempotencyKey={randomUUID()} />
          </div>
        </div>
        <PlatformOperationsPanel operations={platformOperations} />
      </div>
    );
  }

  if (access.type === "unassigned") {
    return (
      <div className="panel-content">
        <p className="eyebrow">Acceso pendiente</p>
        <h1>Tu cuenta todavía no tiene un negocio asignado</h1>
        <p className="panel-lead">
          El acceso es válido, pero falta completar la invitación del negocio.
        </p>
      </div>
    );
  }

  const context = access.tenantContexts[0];
  if (!context) {
    return (
      <div className="panel-content">
        <h1>No encontramos un negocio asignado</h1>
      </div>
    );
  }

  const editableProfile = businessProfile ?? {
    address: "",
    contactPhone: "",
    coverAssetId: null,
    description: "",
    displayName: context.tenant.name,
    languages: ["es"],
    logoAssetId: null,
    openingHours: "",
    referenceAssetIds: [],
    visual: {
      accentColor: "#D97706",
      headingStyle: "serif" as const,
      layout: "visual" as const,
      primaryColor: "#1F2937",
      secondaryColor: "#F9FAFB"
    }
  };

  return (
    <div className="panel-content">
      <p className="eyebrow">Administrador del negocio</p>
      <h1>{context.tenant.name}</h1>
      <p className="panel-lead">
        Ubicación principal: {context.location.name}. Estado del negocio:{" "}
        <strong>{context.tenant.status}</strong>.
      </p>
      <BusinessProfileForm draft={editableProfile} />
      <CatalogEditor
        catalog={catalog}
        languages={editableProfile.languages}
        publishedCatalog={publishedCatalog}
      />
      <div className="panel-module-list" aria-label="Módulos administrativos">
        <div>
          <span>Identidad y menú</span>
          <strong>Gestionar carta</strong>
        </div>
        <div>
          <span>Operación</span>
          <strong>Configurar salón</strong>
        </div>
        <div>
          <span>Personas</span>
          <strong>Gestionar equipo</strong>
        </div>
      </div>
    </div>
  );
}
