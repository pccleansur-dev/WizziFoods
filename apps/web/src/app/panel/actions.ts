"use server";

import { randomUUID } from "node:crypto";

import { readWebConfig } from "@platform/config";
import { redirect } from "next/navigation";

import { createAuthServerClient } from "../../auth/supabase-server";
import {
  parseProvisionedTenant,
  type TenantProvisioningActionState
} from "./tenant-provisioning-state";

function errorState(
  previousState: TenantProvisioningActionState,
  message: string
): TenantProvisioningActionState {
  return { ...previousState, message, status: "error" };
}

export async function createTenantAction(
  previousState: TenantProvisioningActionState,
  formData: FormData
): Promise<TenantProvisioningActionState> {
  const name = formData.get("name");
  const slug = formData.get("slug");
  const adminEmail = formData.get("adminEmail");
  if (
    typeof name !== "string" ||
    typeof slug !== "string" ||
    typeof adminEmail !== "string"
  ) {
    return errorState(previousState, "Revisá los datos del negocio.");
  }

  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.aal !== "aal2") {
    return errorState(
      previousState,
      "La sesión venció o necesita el segundo factor. Volvé a ingresar."
    );
  }
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken) {
    return errorState(previousState, "La sesión venció. Volvé a ingresar.");
  }

  const config = readWebConfig(process.env);
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/v1/platform/tenants`, {
      body: JSON.stringify({ adminEmail, name, slug }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": previousState.idempotencyKey
      },
      method: "POST"
    });
  } catch {
    return errorState(
      previousState,
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }

  if (response.status === 401 || response.status === 403) {
    return errorState(
      previousState,
      "Tu sesión no permite crear negocios. Volvé a ingresar."
    );
  }
  if (!response.ok) {
    return errorState(
      previousState,
      response.status === 400
        ? "Revisá el nombre, identificador y correo del negocio."
        : "No pudimos crear el negocio. Intentá nuevamente."
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return errorState(
      previousState,
      "El negocio fue procesado, pero no pudimos confirmar el resultado."
    );
  }
  const result = parseProvisionedTenant(responseBody);
  if (!result) {
    return errorState(
      previousState,
      "El negocio fue procesado, pero no pudimos confirmar el resultado."
    );
  }

  return {
    idempotencyKey: randomUUID(),
    message: `Creamos ${result.tenant.name}, enviamos la invitación a ${result.adminEmail} y reservamos https://${result.domain.hostname}.`,
    status: "success"
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/acceso");
}
