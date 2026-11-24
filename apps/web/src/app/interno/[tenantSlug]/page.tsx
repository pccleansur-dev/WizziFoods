import { notFound, redirect } from "next/navigation";

import { staffSessionCookieName } from "../../../staff/staff-access";

export default async function StaffAccessPage({
  params,
  searchParams
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ estado?: string }>;
}) {
  const { tenantSlug } = await params;
  try {
    staffSessionCookieName(tenantSlug);
  } catch {
    notFound();
  }
  const query = new URLSearchParams({ tipo: "equipo", local: tenantSlug });
  if ((await searchParams).estado === "no-disponible") {
    query.set("estado", "no-disponible");
  }
  redirect("/acceso?" + query.toString());
}
