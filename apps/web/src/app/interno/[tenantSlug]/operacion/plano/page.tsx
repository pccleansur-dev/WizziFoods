import { redirect } from "next/navigation";

import { loadStaffSession } from "../../../../../staff/load-staff-session";
import { FloorPlanEditor } from "../../../../panel/plano/floor-plan-editor";
import { reloadStaffFloorPlan, saveStaffFloorPlan } from "./actions";

export default async function StaffFloorPlanPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await loadStaffSession(tenantSlug);
  const operation = `/interno/${tenantSlug}/operacion`;
  if (!session.identity.staff.capabilities.includes("salon.manage")) {
    redirect(operation);
  }
  const { plan, qr, version } = await reloadStaffFloorPlan(tenantSlug);

  return (
    <main className="staff-operation-shell">
      <header className="staff-operation-header">
        <strong>{session.identity.location.name}</strong>
        <a className="panel-module-link" href={`${operation}/salon`}>
          Volver al salón
        </a>
      </header>
      {plan && qr && version !== null ? (
        <FloorPlanEditor
          initialPlan={plan}
          initialQr={qr}
          initialVersion={version}
          onReload={reloadStaffFloorPlan.bind(null, tenantSlug)}
          onSave={saveStaffFloorPlan.bind(null, tenantSlug)}
        />
      ) : (
        <section className="panel-content" role="alert">
          <h1>No pudimos cargar el plano del salón</h1>
        </section>
      )}
    </main>
  );
}
