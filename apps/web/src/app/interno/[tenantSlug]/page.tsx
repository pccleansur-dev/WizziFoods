import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { brandIconUrl, loadBrand } from "../../../lib/brand";
import { staffSessionCookieName } from "../../../staff/staff-access";
import { StaffLoginForm } from "./staff-login-form";

/** La marca del negocio de este host; sin pedido HTTP (pruebas) o sin respuesta, la neutral. */
async function currentBrand() {
  try {
    return await loadBrand((await headers()).get("host") ?? "");
  } catch {
    return null;
  }
}

export default async function StaffAccessPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  try {
    staffSessionCookieName(tenantSlug);
  } catch {
    notFound();
  }
  const brand = await currentBrand();

  return (
    <main className="staff-access-shell">
      <section
        className="staff-access-card"
        aria-labelledby="staff-access-title"
      >
        {brand?.logoVersion ? (
          // eslint-disable-next-line @next/next/no-img-element -- ícono generado por la API
          <img
            alt=""
            className="staff-access-brand staff-access-brand--logo"
            height={48}
            src={brandIconUrl(192, { version: brand.logoVersion })}
            width={48}
          />
        ) : (
          <div className="staff-access-brand" aria-hidden="true">
            {brand ? Array.from(brand.name)[0]?.toUpperCase() : "LP"}
          </div>
        )}
        {brand ? <p className="staff-access-business">{brand.name}</p> : null}
        <p className="access-step">Acceso interno</p>
        <h1 id="staff-access-title">Comenzá tu turno</h1>
        <p className="staff-access-lead">
          Ingresá con el usuario y PIN que te asignó el administrador del
          negocio.
        </p>
        <StaffLoginForm tenantSlug={tenantSlug} />
        <p className="access-help">
          Si tu cuenta está bloqueada o no recordás el PIN, pedile ayuda a un
          encargado.
        </p>
      </section>
    </main>
  );
}
