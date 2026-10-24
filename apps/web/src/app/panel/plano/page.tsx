import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../../auth/load-admin-access";
import { reloadFloorPlanAction, saveFloorPlanAction } from "./actions";
import { FloorPlanEditor } from "./floor-plan-editor";
import { loadFloorPlan } from "./floor-plan";

export default async function FloorPlanPage() {
  const result = await loadAdministrativeAccess();
  if (result.status === "unauthenticated") redirect("/acceso/continuar");

  const isTenantAdmin =
    result.status === "ready" && result.data.access.type === "tenant_admin";
  const floorPlan = isTenantAdmin
    ? await loadFloorPlan((await headers()).get("host") ?? "")
    : null;

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <span className="platform-wordmark">La plataforma</span>
        <Link className="button button--secondary" href="/panel">
          Volver al panel
        </Link>
      </header>
      {floorPlan?.status === "ready" ? (
        <FloorPlanEditor
          initialPlan={floorPlan.data.plan}
          initialQr={floorPlan.data.qr}
          initialVersion={floorPlan.data.version}
          onReload={reloadFloorPlanAction}
          onSave={saveFloorPlanAction}
        />
      ) : (
        <section className="panel-content" role="alert">
          <p className="eyebrow">Plano del salón</p>
          <h1>No pudimos cargar el plano</h1>
          <p className="panel-lead">
            {isTenantAdmin
              ? "Tu sesión sigue protegida. Esperá un momento y volvé a intentar."
              : "Esta sección es exclusiva del Administrador del negocio."}
          </p>
        </section>
      )}
    </main>
  );
}
