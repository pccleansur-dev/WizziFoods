"use server";

import {
  parseTranslationRequest,
  type TranslationText
} from "@platform/contracts";

import { adminApi, dataOf } from "./admin-api";

export type TranslateActionState = {
  message: string;
  status: "error" | "ok" | "unavailable";
  translations: TranslationText[];
};

const state = (
  status: TranslateActionState["status"],
  message: string,
  translations: TranslationText[] = []
): TranslateActionState => ({ message, status, translations });

function readTranslations(value: unknown): TranslationText[] | null {
  const data = value as { translations?: unknown } | undefined;
  if (!data || !Array.isArray(data.translations)) return null;
  const result: TranslationText[] = [];
  for (const entry of data.translations) {
    const item = entry as { key?: unknown; text?: unknown };
    if (typeof item?.key !== "string" || typeof item.text !== "string") {
      return null;
    }
    result.push({ key: item.key, text: item.text });
  }
  return result;
}

/**
 * Envía sólo textos con clave y los dos idiomas: el negocio sale de la sesión y
 * el dominio, y la clave del proveedor nunca llega al navegador.
 */
export async function translateCatalogAction(
  request: unknown
): Promise<TranslateActionState> {
  const parsed = parseTranslationRequest(request);
  if (!parsed) return state("error", "No hay nada para traducir.");
  try {
    const result = await adminApi("/v1/tenant/catalog/translations", {
      body: parsed,
      method: "POST"
    });
    if (!result.ok) {
      if (result.status === 401) {
        return state("error", "La sesión venció. Volvé a ingresar.");
      }
      return state(
        result.status === 503 ? "unavailable" : "error",
        result.message ?? "No pudimos traducir ahora. Intentá de nuevo."
      );
    }
    const translations = readTranslations(dataOf(result.body));
    if (!translations)
      return state("error", "Respuesta de traducción inválida.");
    return state("ok", "", translations);
  } catch {
    return state(
      "error",
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }
}
