import { readWebConfig } from "@platform/config";
import { headers } from "next/headers";

import { createAuthServerClient } from "../../auth/supabase-server";
import { tenantFetch } from "./tenant-fetch";

export type AdminApiResult =
  | { body: unknown; ok: true; status: number }
  | {
      code: string | null;
      message: string | null;
      ok: false;
      /** Requisitos que acompañan a BUSINESS_NOT_READY (sin validar). */
      readiness?: unknown;
      status: number;
    };

/**
 * Calls the tenant administration API for the signed-in Administrator. The
 * tenant and location are never sent: the API derives them from the session
 * and the host of this request.
 */
export async function adminApi(
  path: string,
  init: {
    body?: unknown;
    method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  } = {}
): Promise<AdminApiResult> {
  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  const host = (await headers()).get("host");
  if (
    claims.error ||
    claims.data?.claims.aal !== "aal2" ||
    session.error ||
    !accessToken ||
    !host
  ) {
    return { code: "SESSION_EXPIRED", message: null, ok: false, status: 401 };
  }

  const config = readWebConfig(process.env);
  const response = await tenantFetch(`${config.apiUrl}${path}`, {
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      host
    },
    method: init.method ?? "GET"
  });
  const body: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return { body, ok: true, status: response.status };

  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body.error as {
          code?: unknown;
          message?: unknown;
          readiness?: unknown;
        })
      : null;
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message:
      typeof error?.message === "string" && error.message.length < 300
        ? error.message
        : null,
    ok: false,
    ...(error?.readiness === undefined ? {} : { readiness: error.readiness }),
    status: response.status
  };
}

export function dataOf(body: unknown): unknown {
  return typeof body === "object" && body !== null && "data" in body
    ? (body as { data: unknown }).data
    : undefined;
}
