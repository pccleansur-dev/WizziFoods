import { parseCatalogDraft } from "@platform/contracts";
import { redirect } from "next/navigation";

import { loadStaffSession } from "../../../../../staff/load-staff-session";
import { callStaffApi } from "../../../../../staff/waiter-api";
import { buildWaiterMenu } from "../../../../../staff/waiter-view";
import { StaffCatalogSearch } from "./catalog-search";

async function loadPublishedMenu(tenantSlug: string) {
  const response = await callStaffApi(
    tenantSlug,
    "GET",
    "/v1/staff/menu"
  ).catch(() => null);
  if (!response) return { status: "error" } as const;
  if ("sessionMissing" in response || response.status === 401) {
    redirect(`/interno/${tenantSlug}`);
  }
  if (!response.ok) return { status: "error" } as const;

  const data = (response.body as { data?: unknown } | null)?.data;
  if (data === null) return { status: "unpublished" } as const;
  if (typeof data !== "object") return { status: "error" } as const;
  const { availability, catalog } = data as {
    availability?: Record<string, { isAvailable: boolean; version: number }>;
    catalog?: unknown;
  };
  const parsed = parseCatalogDraft(catalog);
  if (!parsed || !availability) return { status: "error" } as const;

  return {
    status: "ready",
    products: buildWaiterMenu(parsed, availability, true).map((product) => ({
      ...product,
      available: availability[product.id]?.isAvailable !== false,
      version: availability[product.id]?.version ?? null
    }))
  } as const;
}

export default async function StaffCatalogPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await loadStaffSession(tenantSlug);
  const home = `/interno/${tenantSlug}/operacion`;
  if (!session.identity.staff.capabilities.includes("menu.manage")) {
    redirect(home);
  }
  const canChangeAvailability = session.identity.staff.capabilities.includes(
    "menu.availability.manage"
  );
  const menu = await loadPublishedMenu(tenantSlug);

  return (
    <main className="staff-operation-shell">
      <header className="staff-operation-header">
        <strong>{session.identity.location.name}</strong>
        <a className="panel-module-link" href={home}>
          Inicio
        </a>
      </header>
      <section
        className="staff-operation-content"
        aria-labelledby="staff-catalog"
      >
        <h1 id="staff-catalog">Carta publicada</h1>
        {menu.status === "error" && (
          <p role="alert">No pudimos cargar la carta. Volvé a intentar.</p>
        )}
        {menu.status === "unpublished" && (
          <p>El negocio todavía no tiene una carta publicada.</p>
        )}
        {menu.status === "ready" && (
          <StaffCatalogSearch
            products={menu.products}
            canChangeAvailability={canChangeAvailability}
            tenantSlug={tenantSlug}
          />
        )}
      </section>
    </main>
  );
}
