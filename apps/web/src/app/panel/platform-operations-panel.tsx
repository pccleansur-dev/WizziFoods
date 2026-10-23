import type { PlatformOperations } from "./platform-operations";
import { TenantSuspensionForm } from "./tenant-suspension-form";

const statusLabels = {
  active: "Activo",
  draft: "Borrador",
  suspended: "Suspendido"
} as const;

const actionLabels: Record<string, string> = {
  "support_access.granted": "Soporte autorizado",
  "support_access.revoked": "Soporte revocado",
  "tenant.suspension_completed": "Suspensión comercial completada",
  "tenant.suspension_requested": "Suspensión solicitada"
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires"
  }).format(new Date(value));
}

export function PlatformOperationsPanel({
  operations
}: {
  operations: PlatformOperations | null;
}) {
  if (!operations) {
    return (
      <section
        className="platform-operations"
        aria-labelledby="operations-title"
      >
        <div>
          <p className="eyebrow">Control operativo</p>
          <h2 id="operations-title">Negocios e historial</h2>
        </div>
        <p className="panel-empty-state" role="alert">
          No pudimos cargar el estado operativo. La creación de negocios sigue
          disponible; recargá la página antes de aplicar una suspensión.
        </p>
      </section>
    );
  }

  return (
    <section className="platform-operations" aria-labelledby="operations-title">
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Control operativo</p>
          <h2 id="operations-title">Negocios e historial</h2>
        </div>
        <p>
          Las medidas quedan asociadas a tu identidad, motivo y correlación.
        </p>
      </div>

      <div className="operations-grid">
        <div className="operations-card">
          <h3>Suspender un negocio</h3>
          <p>
            Elegí el modo comercial para respetar mesas abiertas. Usá seguridad
            sólo cuando sea necesario bloquear el acceso inmediatamente.
          </p>
          <TenantSuspensionForm tenants={operations.tenants} />
        </div>

        <div className="operations-card operations-card--tenants">
          <h3>Estado de los negocios</h3>
          {operations.tenants.length === 0 ? (
            <p className="panel-empty-state" role="status">
              Todavía no hay negocios creados.
            </p>
          ) : (
            <ul className="tenant-status-list">
              {operations.tenants.map((tenant) => (
                <li key={tenant.id}>
                  <div>
                    <strong>{tenant.name}</strong>
                    <span>{tenant.primaryHostname ?? tenant.slug}</span>
                  </div>
                  <span className={`status-pill status-pill--${tenant.status}`}>
                    {tenant.suspension?.phase === "commercial_draining"
                      ? "Cerrando mesas"
                      : statusLabels[tenant.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="audit-panel">
        <div>
          <h3>Actividad sensible reciente</h3>
          <p>Últimos 50 eventos, sin secretos ni datos completos de pago.</p>
        </div>
        {operations.auditEvents.length === 0 ? (
          <p className="panel-empty-state" role="status">
            Aún no hay eventos sensibles registrados.
          </p>
        ) : (
          <div className="audit-table-scroll" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Negocio</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Correlación</th>
                </tr>
              </thead>
              <tbody>
                {operations.auditEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDate(event.occurredAt)}</td>
                    <td>{event.tenantName}</td>
                    <td>{actionLabels[event.action] ?? event.action}</td>
                    <td>{event.reason}</td>
                    <td>
                      <code>{event.correlationId}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
