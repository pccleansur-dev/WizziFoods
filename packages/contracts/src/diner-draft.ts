export type DinerDraftItem = {
  lineId: string;
  productId: string;
  quantity: number;
  variantId: string | null;
};

export type DinerDraftRequest = {
  items: DinerDraftItem[];
  token: string;
};

export type DinerDraftItemStatus =
  "available" | "product_missing" | "product_unavailable" | "variant_missing";

export type DinerDraftQuoteItem = DinerDraftItem & {
  status: DinerDraftItemStatus;
  title: string;
  totalCents: number;
  unitPriceCents: number;
  variantTitle: string | null;
};

export type DinerDraftQuote = {
  canConfirm: boolean;
  catalogRevision: number | null;
  items: DinerDraftQuoteItem[];
  totalCents: number;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const tokenPattern = /^[0-9a-f]{64}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[]
): boolean {
  return Object.keys(value).sort().join("\0") === expected.sort().join("\0");
}

export function parseDinerDraftRequest(
  input: unknown
): DinerDraftRequest | null {
  const candidate = record(input);
  if (
    !candidate ||
    !hasExactKeys(candidate, ["items", "token"]) ||
    typeof candidate.token !== "string" ||
    !tokenPattern.test(candidate.token) ||
    !Array.isArray(candidate.items) ||
    candidate.items.length > 50
  ) {
    return null;
  }

  const items: DinerDraftItem[] = [];
  for (const value of candidate.items) {
    const item = record(value);
    if (
      !item ||
      !hasExactKeys(item, ["lineId", "productId", "quantity", "variantId"]) ||
      typeof item.lineId !== "string" ||
      !uuidPattern.test(item.lineId) ||
      typeof item.productId !== "string" ||
      !uuidPattern.test(item.productId) ||
      !Number.isSafeInteger(item.quantity) ||
      (item.quantity as number) < 1 ||
      (item.quantity as number) > 20 ||
      !(
        item.variantId === null ||
        (typeof item.variantId === "string" && uuidPattern.test(item.variantId))
      )
    ) {
      return null;
    }
    items.push({
      lineId: item.lineId,
      productId: item.productId,
      quantity: item.quantity as number,
      variantId: item.variantId
    });
  }

  if (new Set(items.map(({ lineId }) => lineId)).size !== items.length) {
    return null;
  }
  return { items, token: candidate.token };
}
