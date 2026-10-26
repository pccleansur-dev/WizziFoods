import { readWebConfig } from "@platform/config";
import { cookies } from "next/headers";

import { staffSessionCookieName } from "./staff-access";

export type WaiterApiResponse =
  { body: unknown; ok: boolean; status: number } | { sessionMissing: true };

/**
 * Server-only call to the staff API. The opaque session token lives in an
 * httpOnly cookie scoped to the tenant slug and is sent as a Bearer; the browser
 * never sees it and never supplies tenant, location, identity or role.
 */
export async function callStaffApi(
  tenantSlug: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  payload?: unknown
): Promise<WaiterApiResponse> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(staffSessionCookieName(tenantSlug))?.value;
  } catch {
    token = undefined;
  }
  if (!token) return { sessionMissing: true };

  const config = readWebConfig(process.env);
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" })
    },
    method
  });
  const body: unknown = await response.json().catch(() => null);
  return { body, ok: response.ok, status: response.status };
}
