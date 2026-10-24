import { randomUUID } from "node:crypto";

import type { AdministrativeAccess } from "../../auth/admin-access";
import {
  onboardingProgress,
  type OnboardingProgress
} from "./onboarding/steps";
import { OnboardingOverview } from "./onboarding/onboarding-overview";
import type { PlatformOperations } from "./platform-operations";
import { PlatformOperationsPanel } from "./platform-operations-panel";
import { TenantProvisioningForm } from "./tenant-provisioning-form";

export function PanelContent({
  administrativeAccess,
  onboarding = onboardingProgress(null),
  platformOperations = null
}: {
  administrativeAccess: AdministrativeAccess;
  onboarding?: OnboardingProgress;
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

  return (
    <div className="panel-content">
      <p className="eyebrow">Administrador del negocio</p>
      <h1>{context.tenant.name}</h1>
      <p className="panel-lead">
        Ubicación principal: {context.location.name}. Estado del negocio:{" "}
        <strong>{context.tenant.status}</strong>.
      </p>
      <OnboardingOverview progress={onboarding} />
    </div>
  );
}
