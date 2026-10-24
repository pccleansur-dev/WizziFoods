/**
 * Traducción automática de la carta (T15). El cliente envía sólo textos con una
 * clave opaca y dos idiomas; el negocio y la ubicación salen de la sesión. La
 * respuesta del proveedor se valida contra lo pedido antes de usarse.
 */

export const TRANSLATION_LIMITS = {
  maxKeyLength: 100,
  maxTextLength: 1_000,
  maxTexts: 400
} as const;

export type TranslationText = { key: string; text: string };

export type TranslationRequest = {
  sourceLanguage: string;
  targetLanguage: string;
  texts: TranslationText[];
};

const languagePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/u;
const keyPattern =
  /^(?:category|product|variant):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(?:title|description)$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= TRANSLATION_LIMITS.maxTextLength
  );
}

export function parseTranslationRequest(
  value: unknown
): TranslationRequest | null {
  const raw = record(value);
  if (
    !raw ||
    !exact(raw, ["sourceLanguage", "targetLanguage", "texts"]) ||
    typeof raw.sourceLanguage !== "string" ||
    typeof raw.targetLanguage !== "string" ||
    !languagePattern.test(raw.sourceLanguage) ||
    !languagePattern.test(raw.targetLanguage) ||
    raw.sourceLanguage === raw.targetLanguage ||
    !Array.isArray(raw.texts) ||
    raw.texts.length < 1 ||
    raw.texts.length > TRANSLATION_LIMITS.maxTexts
  ) {
    return null;
  }
  const seen = new Set<string>();
  const texts: TranslationText[] = [];
  for (const entry of raw.texts) {
    const item = record(entry);
    if (
      !item ||
      !exact(item, ["key", "text"]) ||
      typeof item.key !== "string" ||
      item.key.length > TRANSLATION_LIMITS.maxKeyLength ||
      !keyPattern.test(item.key) ||
      seen.has(item.key) ||
      !validText(item.text)
    ) {
      return null;
    }
    seen.add(item.key);
    texts.push({ key: item.key, text: item.text.trim() });
  }
  return {
    sourceLanguage: raw.sourceLanguage,
    targetLanguage: raw.targetLanguage,
    texts
  };
}

/**
 * Valida lo que devuelve el proveedor: exactamente las claves pedidas, una vez
 * cada una y con texto acotado. Devuelve el resultado en el orden del pedido.
 */
export function parseTranslationResult(
  value: unknown,
  request: TranslationRequest
): TranslationText[] | null {
  const raw = record(value);
  if (
    !raw ||
    !exact(raw, ["translations"]) ||
    !Array.isArray(raw.translations) ||
    raw.translations.length !== request.texts.length
  ) {
    return null;
  }
  const byKey = new Map<string, string>();
  for (const entry of raw.translations) {
    const item = record(entry);
    if (
      !item ||
      !exact(item, ["key", "text"]) ||
      typeof item.key !== "string" ||
      byKey.has(item.key) ||
      !validText(item.text)
    ) {
      return null;
    }
    byKey.set(item.key, item.text.trim());
  }
  const ordered: TranslationText[] = [];
  for (const { key } of request.texts) {
    const text = byKey.get(key);
    if (text === undefined) return null;
    ordered.push({ key, text });
  }
  return ordered;
}
