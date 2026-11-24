import type { WaiterMenuProduct } from "./waiter-view";

function searchable(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function searchWaiterMenu<T extends WaiterMenuProduct>(
  menu: T[],
  query: string
): T[] {
  const terms = searchable(query).trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return menu;
  return menu.filter((product) => {
    const subject = searchable(
      [
        product.title,
        product.categoryTitle,
        ...product.variants.map(({ title }) => title)
      ].join(" ")
    );
    return terms.every((term) => subject.includes(term));
  });
}
