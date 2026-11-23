"use server";

import { isWaiterUuid } from "@platform/contracts";
import { revalidatePath } from "next/cache";

import { callStaffApi } from "../../../../../staff/waiter-api";

export type AvailabilityFeedback = { message: string; ok: boolean } | null;

export async function updateAvailability(
  tenantSlug: string,
  productId: string,
  expectedVersion: number | null,
  isAvailable: boolean
): Promise<AvailabilityFeedback> {
  const unavailable = {
    message: "No pudimos guardar el cambio. Volvé a intentar.",
    ok: false
  };
  if (!isWaiterUuid(productId)) return unavailable;

  const response = await callStaffApi(
    tenantSlug,
    "POST",
    `/v1/staff/menu/products/${productId}/availability`,
    { expectedVersion, isAvailable }
  ).catch(() => null);
  if (!response) return unavailable;
  if ("sessionMissing" in response || response.status === 401) {
    return { message: "Tu turno venció. Volvé a ingresar.", ok: false };
  }
  if (response.status === 403) {
    return { message: "Tu rol no puede cambiar la disponibilidad.", ok: false };
  }
  const operation = `/interno/${tenantSlug}/operacion`;
  if (response.status === 409 || response.status === 404) {
    revalidatePath(`${operation}/carta`);
    return {
      message:
        "La carta cambió. Revisá el estado actualizado antes de intentarlo de nuevo.",
      ok: false
    };
  }
  if (!response.ok) return unavailable;

  revalidatePath(`${operation}/carta`);
  revalidatePath(`${operation}/salon`);
  return {
    message: isAvailable
      ? "Producto disponible."
      : "Producto marcado como agotado.",
    ok: true
  };
}
