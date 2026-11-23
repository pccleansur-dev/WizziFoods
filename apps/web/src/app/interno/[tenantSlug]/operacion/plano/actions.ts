"use server";

import { parseFloorPlanCommand } from "@platform/contracts";
import { redirect } from "next/navigation";

import { callStaffApi } from "../../../../../staff/waiter-api";
import {
  parseFloorPlanQrResponse,
  parseFloorPlanResponse,
  parseFloorPlanSaveResponse,
  type FloorPlanActionState
} from "../../../../panel/plano/floor-plan";

const path = "/v1/staff/floor-plan";
const failure = (
  message: string,
  status: FloorPlanActionState["status"] = "error",
  issues: FloorPlanActionState["issues"] = []
): FloorPlanActionState => ({
  issues,
  message,
  plan: null,
  qr: null,
  status,
  version: null
});

export async function reloadStaffFloorPlan(
  tenantSlug: string
): Promise<FloorPlanActionState> {
  const response = await callStaffApi(tenantSlug, "GET", path).catch(
    () => null
  );
  if (response && ("sessionMissing" in response || response.status === 401)) {
    redirect(`/interno/${tenantSlug}`);
  }
  if (!response?.ok) return failure("No pudimos cargar el plano del salón.");

  try {
    const data = (response.body as { data?: { qr?: unknown } } | null)?.data;
    return {
      ...parseFloorPlanResponse(response.body),
      issues: [],
      message: "Plano actualizado con la última versión guardada.",
      qr: parseFloorPlanQrResponse({ data: data?.qr }),
      status: "saved"
    };
  } catch {
    return failure("No pudimos cargar el plano del salón.");
  }
}

export async function saveStaffFloorPlan(
  tenantSlug: string,
  serializedCommand: string
): Promise<FloorPlanActionState> {
  if (
    typeof serializedCommand !== "string" ||
    serializedCommand.length > 1_000_000
  ) {
    return failure("El plano enviado no es válido.", "invalid");
  }
  let parsed;
  try {
    parsed = parseFloorPlanCommand(JSON.parse(serializedCommand));
  } catch {
    return failure("El plano enviado no es válido.", "invalid");
  }
  if (!parsed.ok) {
    return failure(
      "Revisá los datos marcados del plano.",
      "invalid",
      parsed.issues
    );
  }

  const response = await callStaffApi(
    tenantSlug,
    "PUT",
    path,
    parsed.command
  ).catch(() => null);
  if (response && ("sessionMissing" in response || response.status === 401)) {
    redirect(`/interno/${tenantSlug}`);
  }
  if (!response?.ok) {
    const error = (
      response?.body as { error?: { code?: string; message?: string } } | null
    )?.error;
    return failure(
      typeof error?.message === "string" && error.message.length < 300
        ? error.message
        : "No pudimos guardar el plano. Tus cambios siguen en pantalla.",
      error?.code === "FLOOR_PLAN_VERSION_CONFLICT" ? "conflict" : "error"
    );
  }

  let saved;
  try {
    saved = parseFloorPlanSaveResponse(response.body);
  } catch {
    return failure("No pudimos confirmar el guardado. Volvé a intentar.");
  }
  const latest = await reloadStaffFloorPlan(tenantSlug);
  if (latest.status === "error") {
    return failure(
      "El guardado llegó, pero no pudimos actualizar el plano y los QR. Recargá para verlos."
    );
  }
  return {
    ...latest,
    message: saved.applied
      ? "Plano guardado. Los QR de las mesas nuevas ya están listos."
      : "Ese guardado ya estaba aplicado.",
    status: saved.applied ? "saved" : "replayed"
  };
}
