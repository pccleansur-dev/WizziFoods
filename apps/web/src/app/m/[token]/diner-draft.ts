import {
  parseDinerDraftRequest,
  type DinerDraftItem,
  type DinerDraftItemStatus,
  type DinerDraftQuote
} from "@platform/contracts";

const storageToken = "0".repeat(64);
const itemStatuses = new Set<DinerDraftItemStatus>([
  "available",
  "product_missing",
  "product_unavailable",
  "variant_missing"
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hash(value: string): string {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(36);
}

export function draftStorageKey(host: string, token: string): string {
  return `mozo:diner-draft:v1:${hash(`${host}\0${token}`)}`;
}

export function parseStoredDraft(value: string | null): DinerDraftItem[] {
  if (!value) return [];
  try {
    const parsed = parseDinerDraftRequest({
      items: JSON.parse(value),
      token: storageToken
    });
    return parsed?.items ?? [];
  } catch {
    return [];
  }
}

export function addDraftItem(
  items: DinerDraftItem[],
  added: DinerDraftItem
): DinerDraftItem[] {
  const existing = items.find(
    ({ productId, variantId }) =>
      productId === added.productId && variantId === added.variantId
  );
  if (!existing) return [...items, added];
  return items.map((item) =>
    item.lineId === existing.lineId
      ? { ...item, quantity: Math.min(20, item.quantity + added.quantity) }
      : item
  );
}

export function setDraftQuantity(
  items: DinerDraftItem[],
  lineId: string,
  quantity: number
): DinerDraftItem[] {
  if (quantity < 1) return items.filter((item) => item.lineId !== lineId);
  return items.map((item) =>
    item.lineId === lineId
      ? { ...item, quantity: Math.min(20, quantity) }
      : item
  );
}

export function parseDinerDraftQuoteResponse(
  body: unknown
): DinerDraftQuote | null {
  const root = record(body);
  const data = record(root?.data);
  const draft = record(data?.draft);
  if (
    data?.status !== "ok" ||
    !draft ||
    typeof draft.canConfirm !== "boolean" ||
    !(
      draft.catalogRevision === null ||
      (Number.isSafeInteger(draft.catalogRevision) &&
        (draft.catalogRevision as number) > 0)
    ) ||
    !Array.isArray(draft.items) ||
    !Number.isSafeInteger(draft.totalCents) ||
    (draft.totalCents as number) < 0
  ) {
    return null;
  }

  const selection = parseDinerDraftRequest({
    items: draft.items.map((value) => {
      const item = record(value);
      return item
        ? {
            lineId: item.lineId,
            productId: item.productId,
            quantity: item.quantity,
            variantId: item.variantId
          }
        : value;
    }),
    token: storageToken
  });
  if (!selection) return null;

  const items = draft.items.map((value, index) => {
    const item = record(value)!;
    const status = item.status as DinerDraftItemStatus;
    if (
      Object.keys(item).sort().join() !==
        "lineId,productId,quantity,status,title,totalCents,unitPriceCents,variantId,variantTitle" ||
      !itemStatuses.has(status) ||
      typeof item.title !== "string" ||
      !(item.variantTitle === null || typeof item.variantTitle === "string") ||
      !Number.isSafeInteger(item.unitPriceCents) ||
      (item.unitPriceCents as number) < 0 ||
      !Number.isSafeInteger(item.totalCents) ||
      item.totalCents !==
        (item.unitPriceCents as number) * selection.items[index]!.quantity
    ) {
      return null;
    }
    return {
      ...selection.items[index]!,
      status,
      title: item.title,
      totalCents: item.totalCents as number,
      unitPriceCents: item.unitPriceCents as number,
      variantTitle: item.variantTitle as string | null
    };
  });
  if (items.some((item) => item === null)) return null;
  const typedItems = items as DinerDraftQuote["items"];
  if (
    typedItems.reduce((sum, item) => sum + item.totalCents, 0) !==
    draft.totalCents
  ) {
    return null;
  }
  return {
    canConfirm: draft.canConfirm,
    catalogRevision: draft.catalogRevision as number | null,
    items: typedItems,
    totalCents: draft.totalCents as number
  };
}
