"use server";

import { parseGoogleReviewUrl } from "@platform/contracts";
import { adminApi, dataOf } from "../admin-api";

const path = "/v1/tenant/business-profile/google-review";

export async function loadGoogleReviewLink() {
  try {
    const result = await adminApi(path);
    return result.ok
      ? { url: parseGoogleReviewUrl(dataOf(result.body)) }
      : null;
  } catch {
    return null;
  }
}

export async function saveGoogleReviewLink(_previous: string, input: unknown) {
  if (typeof input !== "string")
    return "Pegá un enlace de reseñas de Google válido.";
  const value = input.trim();
  const url = parseGoogleReviewUrl(value);
  if (value && !url) return "Pegá un enlace de reseñas de Google válido.";
  try {
    const result = await adminApi(path, { method: "PUT", body: { url } });
    if (result.ok)
      return url
        ? "Enlace guardado. Ya aparece en la carta."
        : "Enlace quitado de la carta.";
  } catch {
    // Keep the field available for retry.
  }
  return "No pudimos guardar el enlace. Volvé a intentar.";
}
