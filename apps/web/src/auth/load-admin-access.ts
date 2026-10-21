import { readWebConfig } from "@platform/config";

import {
  parseAdministrativeAccess,
  type AdministrativeAccess
} from "./admin-access";
import { createAuthServerClient } from "./supabase-server";

export type AdministrativeAccessResult =
  | { data: AdministrativeAccess; status: "ready" }
  | { status: "unauthenticated" | "unavailable" };

export async function loadAdministrativeAccess(): Promise<AdministrativeAccessResult> {
  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();

  if (
    claims.error ||
    claims.data?.claims.aal !== "aal2" ||
    !claims.data.claims.sub
  ) {
    return { status: "unauthenticated" };
  }

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken) return { status: "unauthenticated" };

  const config = readWebConfig(process.env);

  try {
    const response = await fetch(`${config.apiUrl}/v1/me/access`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` }
    });

    if (response.status === 401 || response.status === 403) {
      return { status: "unauthenticated" };
    }

    if (!response.ok) return { status: "unavailable" };
    const parsed = parseAdministrativeAccess(await response.json());
    return parsed
      ? { data: parsed, status: "ready" }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
