import { parseProductionBoard } from "@platform/contracts";
import { redirect } from "next/navigation";

import { loadStaffSession } from "../../../../../staff/load-staff-session";
import { callStaffApi } from "../../../../../staff/waiter-api";
import { signOutStaffAction } from "../../actions";
import { ProductionBoardView } from "./production-board";

async function loadBoard(tenantSlug: string) {
  try {
    const response = await callStaffApi(
      tenantSlug,
      "GET",
      "/v1/staff/production"
    );
    if ("sessionMissing" in response || response.status === 401) {
      return "expired" as const;
    }
    return response.ok
      ? parseProductionBoard((response.body as { data?: unknown } | null)?.data)
      : null;
  } catch {
    return null;
  }
}

export default async function ProductionPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await loadStaffSession(tenantSlug);
  const capabilities = session.identity.staff.capabilities;
  if (
    !capabilities.includes("production.kitchen.manage") &&
    !capabilities.includes("production.bar.manage")
  ) {
    redirect(`/interno/${tenantSlug}/operacion`);
  }

  const board = await loadBoard(tenantSlug);
  if (board === "expired") redirect(`/interno/${tenantSlug}`);

  return (
    <main className="staff-operation-shell">
      <header className="staff-operation-header">
        <div>
          <p className="eyebrow">{session.identity.tenant.name}</p>
          <strong>{session.identity.location.name}</strong>
        </div>
        <nav aria-label="Navegación" className="waiter-header-nav">
          <a
            className="panel-module-link"
            href={`/interno/${tenantSlug}/operacion`}
          >
            Inicio
          </a>
          <form action={signOutStaffAction}>
            <input name="tenantSlug" type="hidden" value={tenantSlug} />
            <button className="button button--secondary" type="submit">
              Cerrar turno
            </button>
          </form>
        </nav>
      </header>
      <div className="waiter-page">
        {board ? (
          <ProductionBoardView initialBoard={board} tenantSlug={tenantSlug} />
        ) : (
          <>
            <h1>Producción</h1>
            <p className="waiter-notice waiter-notice--error" role="alert">
              No pudimos cargar la cola. Recargá la página o volvé a intentar en
              unos segundos.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
