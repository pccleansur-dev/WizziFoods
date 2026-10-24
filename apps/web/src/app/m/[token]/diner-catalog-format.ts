export function catalogTitle(
  content: { language: string; title: string }[]
): string {
  return (
    content.find(({ language }) => language === "es")?.title ??
    content[0]?.title ??
    "Sin nombre"
  );
}

export function catalogDescription(
  content: { description: string; language: string }[]
): string {
  return (
    content.find(({ language }) => language === "es")?.description ??
    content[0]?.description ??
    ""
  );
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    style: "currency"
  }).format(cents / 100);
}
