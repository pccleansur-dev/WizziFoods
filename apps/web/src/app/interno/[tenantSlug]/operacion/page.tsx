import { readWebConfig } from "@platform/config";
import {
  staffRoleLabels,
  type StaffCurrentSessionView
} from "@platform/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { operationModulesFor } from "../../../../staff/operation-modules";
import { staffSessionCookieName } from "../../../../staff/staff-access";
import { signOutStaffAction } from "../actions";

async function loadStaffSession(
  tenantSlug: string
): Promise<StaffCurrentSessionView> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(
    staffSessionCookieName(tenantSlug)
  )?.value;
  if (!accessToken) redirect(`/interno/${tenantSlug}`);

  const config = readWebConfig(process.env);
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/v1/staff-sessions/current`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  } catch {
    redirect(`/interno/${tenantSlug}?estado=no-disponible`);
  }
  if (!response.ok) redirect(`/interno/${tenantSlug}`);

  const payload = (await response.json()) as {
    data: StaffCurrentSessionView;
  };
  if (payload.data.identity.tenant.slug !== tenantSlug) {
    redirect(`/interno/${tenantSlug}`);
  }
  return payload.data;
}

export default async function StaffOperationPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await loadStaffSession(tenantSlug);
  const modules = operationModulesFor(
    session.identity.staff.role,
    session.identity.staff.capabilities
  );

  return (
    <main className="staff-operation-shell">
      <header className="staff-operation-header">
        <div>
          <p className="eyebrow">{session.identity.tenant.name}</p>
          <strong>{session.identity.location.name}</strong>
        </div>
        <form action={signOutStaffAction}>
          <input name="tenantSlug" type="hidden" value={tenantSlug} />
          <button className="button button--secondary" type="submit">
            Cerrar turno
          </button>
        </form>
      </header>

      <section
        className="staff-operation-content"
        aria-labelledby="operation-title"
      >
        <div className="staff-welcome">
          <p className="access-step">
            {staffRoleLabels[session.identity.staff.role]}
          </p>
          <h1 id="operation-title">
            Hola, {session.identity.staff.displayName}
          </h1>
          <p>Elegí el módulo con el que necesitás trabajar.</p>
        </div>

        <div className="staff-module-grid">
          {modules.map((module) => (
            <article className="staff-module-card" key={module.title}>
              <span aria-hidden="true">→</span>
              <h2>{module.title}</h2>
              <p>{module.description}</p>
              <small>Próxima etapa operativa</small>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
