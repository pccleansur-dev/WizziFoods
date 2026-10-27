export const sourceLanguage = "es";

type Localized = {
  description?: string;
  language: string;
  review?: "machine";
  title?: string;
};

/**
 * The languages a diner can read the menu in: the ones with approved text. A machine
 * translation nobody approved is a draft and does not count (it never reaches a published
 * menu, and if one ever did, the diner would still not see it).
 */
export function availableLanguages(
  contents: readonly (readonly Localized[])[]
): string[] {
  const found = new Set<string>();
  for (const content of contents) {
    for (const item of content) {
      if (item.review !== "machine" && item.title?.trim()) {
        found.add(item.language);
      }
    }
  }
  const others = [...found].filter((language) => language !== sourceLanguage);
  return [
    ...(found.has(sourceLanguage) ? [sourceLanguage] : []),
    ...others.sort()
  ];
}

/** `en-US` also tries `en`; then the business's own language; then whatever exists. */
function candidates(preferred: string | null): string[] {
  const base = preferred?.split("-")[0] ?? null;
  return [preferred, base, sourceLanguage].filter(
    (language, index, all): language is string =>
      language !== null && all.indexOf(language) === index
  );
}

function pick(
  content: readonly Localized[],
  field: "description" | "title",
  preferred: string | null
): { language: string; text: string } | null {
  const usable = content.filter((item) => item.review !== "machine");
  const ordered = [
    ...candidates(preferred).flatMap((language) =>
      usable.filter((item) => item.language === language)
    ),
    ...usable
  ];
  for (const item of ordered) {
    const text = item[field]?.trim();
    if (text) return { language: item.language, text };
  }
  return null;
}

/**
 * The text of a menu entry in the language the diner chose, falling back to the
 * business's own language when the translation is missing or empty, so the menu never
 * shows a blank. Only words: prices and availability are not in here and nothing in a
 * translation can change them.
 */
export function localizedTitle(
  content: readonly Localized[],
  preferred: string | null = null
): { language: string; text: string } {
  return (
    pick(content, "title", preferred) ?? {
      language: sourceLanguage,
      text: "Sin nombre"
    }
  );
}

export function localizedDescription(
  content: readonly Localized[],
  preferred: string | null = null
): { language: string; text: string } | null {
  return pick(content, "description", preferred);
}

export function catalogTitle(
  content: readonly Localized[],
  preferred: string | null = null
): string {
  return localizedTitle(content, preferred).text;
}

export function catalogDescription(
  content: readonly Localized[],
  preferred: string | null = null
): string {
  return localizedDescription(content, preferred)?.text ?? "";
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    style: "currency"
  }).format(cents / 100);
}
