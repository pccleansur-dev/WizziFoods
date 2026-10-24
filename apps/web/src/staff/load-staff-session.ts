import { readWebConfig } from "@platform/config";
import type { StaffCurrentSessionView } from "@platform/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { staffSessionCookieName } from "./staff-access";

/** Resolves the current staff session for a server page or redirects to login. */
export async function loadStaffSession(
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
