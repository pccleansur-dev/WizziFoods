import type { AdministrativeAccess } from "../../auth/admin-access";

export function PanelContent({
  administrativeAccess
}: {
  administrativeAccess: AdministrativeAccess;
}) {
  const { access } = administrativeAccess;

  if (access.type === "platform_superadmin") {
    return (
      <div className="panel-content">
        <p className="eyebrow">Superadmin</p>
        <h1>Administración de la plataforma</h1>
        <p className="panel-lead">
          Desde acá se aprovisionan negocios y se controla el estado general,
          sin entrar silenciosamente a la operación de cada restaurante.
        </p>
        <div className="panel-next-action">
          <span>Próxima etapa</span>
          <strong>Crear y entregar negocios</strong>
        </div>
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
