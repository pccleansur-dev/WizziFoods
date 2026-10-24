import { parseCatalogDraft, parseWaiterSalonView } from "@platform/contracts";
import { redirect } from "next/navigation";

import { loadStaffSession } from "../../../../../staff/load-staff-session";
import { callStaffApi } from "../../../../../staff/waiter-api";
import {
  buildWaiterMenu,
  type WaiterMenuProduct
} from "../../../../../staff/waiter-view";
import { signOutStaffAction } from "../../actions";
import { WaiterWorkspace } from "./waiter-workspace";

async function loadMenu(tenantSlug: string): Promise<WaiterMenuProduct[]> {
  try {
    const response = await callStaffApi(tenantSlug, "GET", "/v1/staff/menu");
    if ("sessionMissing" in response || !response.ok) return [];
    const data = (response.body as { data?: unknown } | null)?.data;
    if (typeof data !== "object" || data === null) return [];
    const record = data as { availability?: unknown; catalog?: unknown };
    const catalog = parseCatalogDraft(record.catalog);
    if (!catalog) return [];
    const availability =
      typeof record.availability === "object" && record.availability !== null
        ? (record.availability as Record<string, { isAvailable: boolean }>)
        : {};
    return buildWaiterMenu(catalog, availability);
  } catch {
    return [];
  }
}

async function loadSalon(tenantSlug: string) {
  try {
    const response = await callStaffApi(tenantSlug, "GET", "/v1/staff/salon");
    if ("sessionMissing" in response || response.status === 401) {
      return "expired" as const;
    }
    return response.ok
      ? parseWaiterSalonView((response.body as { data?: unknown } | null)?.data)
      : null;
  } catch {
    return null;
  }
}

export default async function WaiterSalonPage({
  params,
  searchParams
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ vista?: string }>;
}) {
  const { tenantSlug } = await params;
  const { vista } = await searchParams;
  const session = await loadStaffSession(tenantSlug);
  const capabilities = session.identity.staff.capabilities;
  if (!capabilities.includes("tables.serve")) {
    redirect(`/interno/${tenantSlug}/operacion`);
  }

  const salon = await loadSalon(tenantSlug);
  if (salon === "expired") redirect(`/interno/${tenantSlug}`);
  const view = salon;

  const canCreateOrders = capabilities.includes("orders.manage");
  const menu = canCreateOrders ? await loadMenu(tenantSlug) : [];

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
        <h1>Salón</h1>
        {view ? (
          <WaiterWorkspace
            canCreateOrders={canCreateOrders}
            canValidate={capabilities.includes("orders.validate")}
            initialTab={
              vista === "comanda" && canCreateOrders ? "comanda" : "salon"
            }
            initialView={view}
            isManager={session.identity.staff.role === "manager"}
            menu={menu}
            tenantSlug={tenantSlug}
          />
        ) : (
          <p className="waiter-notice waiter-notice--error" role="alert">
            No pudimos cargar el salón. Recargá la página o volvé a intentar en
            unos segundos.
          </p>
        )}
      </div>
    </main>
  );
}
