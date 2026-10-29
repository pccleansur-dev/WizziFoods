"use server";

import { revalidatePath } from "next/cache";
import { readWebConfig } from "@platform/config";
import {
  parseFloorPlanCommand,
  type FloorPlanIssue
} from "@platform/contracts";
import { headers } from "next/headers";

import { createAuthServerClient } from "../../../auth/supabase-server";
import { tenantFetch } from "../tenant-fetch";
import {
  parseFloorPlanQrResponse,
  parseFloorPlanResponse,
  parseFloorPlanSaveResponse,
  type FloorPlanActionState
} from "./floor-plan";

const failure = (
  status: FloorPlanActionState["status"],
  message: string,
  issues: FloorPlanIssue[] = []
): FloorPlanActionState => ({
  issues,
  message,
  plan: null,
  qr: null,
  status,
  version: null
});

async function tenantContext() {
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
    return null;
  }
  return { accessToken, host };
}

function issuesFrom(body: unknown): FloorPlanIssue[] {
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body.error as { issues?: unknown })
      : null;
  if (!error || !Array.isArray(error.issues)) return [];
  return error.issues.filter(
    (issue): issue is FloorPlanIssue =>
      typeof issue === "object" &&
      issue !== null &&
      typeof (issue as FloorPlanIssue).path === "string" &&
      typeof (issue as FloorPlanIssue).message === "string" &&
      typeof (issue as FloorPlanIssue).code === "string"
  );
}

function apiMessage(body: unknown, fallback: string): string {
  const message =
    typeof body === "object" && body !== null && "error" in body
      ? (body.error as { message?: unknown }).message
      : null;
  return typeof message === "string" && message.length < 300
    ? message
    : fallback;
}

async function readQr(
  apiUrl: string,
  auth: { accessToken: string; host: string }
) {
  const response = await tenantFetch(`${apiUrl}/v1/tenant/floor-plan/qr`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${auth.accessToken}`, host: auth.host }
  });
  if (!response.ok) throw new Error("QR unavailable");
  return parseFloorPlanQrResponse(await response.json());
}

/**
 * The same command id is reused by the client while a save is retried, so a
 * lost response never applies the plan twice.
 */
export async function saveFloorPlanAction(
  serializedCommand: string
): Promise<FloorPlanActionState> {
  if (
    typeof serializedCommand !== "string" ||
    serializedCommand.length > 1_000_000
  ) {
    return failure("error", "El plano enviado no es válido.");
  }
  let parsed;
  try {
    parsed = parseFloorPlanCommand(JSON.parse(serializedCommand));
  } catch {
    return failure("error", "El plano enviado no es válido.");
  }
  if (!parsed.ok) {
    return failure(
      "invalid",
      "Revisá los datos marcados del plano.",
      parsed.issues
    );
  }
  const auth = await tenantContext();
  if (!auth) return failure("error", "La sesión venció. Volvé a ingresar.");
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(
      `${config.apiUrl}/v1/tenant/floor-plan`,
      {
        body: JSON.stringify(parsed.command),
        cache: "no-store",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          "content-type": "application/json",
          host: auth.host
        },
        method: "PUT"
      }
    );
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        const conflict = /VERSION_CONFLICT/u.test(JSON.stringify(body));
        return failure(
          conflict ? "conflict" : "error",
          apiMessage(body, "El plano cambió en otra sesión.")
        );
      }
      if (response.status === 400 || response.status === 422) {
        return failure(
          "invalid",
          apiMessage(body, "Revisá los datos marcados del plano."),
          issuesFrom(body)
        );
      }
      return failure(
        "error",
        "No pudimos guardar el plano. Intentá nuevamente."
      );
    }
    const saved = parseFloorPlanSaveResponse(await response.json());
    revalidatePath("/panel", "layout");
    const qr = await readQr(config.apiUrl, auth);
    return {
      issues: [],
      message: saved.applied
        ? "Plano guardado. Los QR de las mesas nuevas ya están listos."
        : "Ese guardado ya estaba aplicado.",
      plan: saved.plan,
      qr,
      status: saved.applied ? "saved" : "replayed",
      version: saved.version
    };
  } catch {
    return failure(
      "error",
      "No pudimos comunicarnos con la plataforma. Tus cambios siguen en pantalla; intentá nuevamente."
    );
  }
}

export async function reloadFloorPlanAction(): Promise<FloorPlanActionState> {
  const auth = await tenantContext();
  if (!auth) return failure("error", "La sesión venció. Volvé a ingresar.");
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(
      `${config.apiUrl}/v1/tenant/floor-plan`,
      {
        cache: "no-store",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          host: auth.host
        }
      }
    );
    if (!response.ok) return failure("error", "No pudimos recargar el plano.");
    const saved = parseFloorPlanResponse(await response.json());
    return {
      issues: [],
      message: "Plano actualizado con la última versión guardada.",
      plan: saved.plan,
      qr: await readQr(config.apiUrl, auth),
      status: "saved",
      version: saved.version
    };
  } catch {
    return failure("error", "No pudimos recargar el plano.");
  }
}
