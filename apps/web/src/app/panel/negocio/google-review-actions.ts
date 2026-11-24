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

export async function saveGoogleReviewLink(
  previous: { url: string | null; message: string },
  formData: FormData
) {
  const input = formData.get("reviewUrl");
  if (typeof input !== "string")
    return {
      ...previous,
      message:
        "Ese enlace no tiene un formato reconocido. Pegá el enlace completo de Google, incluido https://."
    };
  const value = input.trim();
  const url = parseGoogleReviewUrl(value);
  if (value && !url)
    return {
      ...previous,
      message:
        "Ese enlace no tiene un formato reconocido. Pegá el enlace completo de Google, incluido https://."
    };
  try {
    const result = await adminApi(path, { method: "PUT", body: { url } });
    if (!result.ok && (result.status === 401 || result.status === 403))
      return {
        ...previous,
        message:
          "Tu sesión no permite guardar. Volvé a ingresar como administrador."
      };
    if (result.ok) {
      const savedUrl = parseGoogleReviewUrl(dataOf(result.body));
      if (savedUrl === url)
        return {
          url,
          message: url
            ? "Enlace publicado en la carta."
            : "Enlace quitado de la carta."
        };
    }
  } catch {
    // Keep the field available for retry.
  }
  return {
    ...previous,
    message: "No pudimos guardar el enlace. Volvé a intentar."
  };
}
