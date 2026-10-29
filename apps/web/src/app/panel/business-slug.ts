/** Propone el identificador de URL a partir del nombre: sin tildes, minúsculas y con guiones. */
export function suggestBusinessSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
}
