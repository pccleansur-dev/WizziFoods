import type {
  DinerDraftItem,
  DinerDraftQuoteItem,
  DinerDraftRequest,
  TenantHostContext
} from "@platform/contracts";
import type {
  CatalogRepository,
  PublishedCatalogRecord
} from "@platform/database";

import type { TableEntryService } from "../table-entry/table-entry.service.js";

const missingProductTitle = "Producto no disponible";

function localizedTitle(
  content: { language: string; title: string }[]
): string {
  return (
    content.find(({ language }) => language === "es")?.title ??
    content[0]?.title ??
    missingProductTitle
  );
}

function quoteItem(
  item: DinerDraftItem,
  current: PublishedCatalogRecord | null
): DinerDraftQuoteItem {
  const product = current?.catalog.products.find(
    ({ id }) => id === item.productId
  );
  if (!product) {
    return {
      ...item,
      status: "product_missing",
      title: missingProductTitle,
      totalCents: 0,
      unitPriceCents: 0,
      variantTitle: null
    };
  }

  const variant = item.variantId
    ? product.variants.find(({ id }) => id === item.variantId)
    : null;
  if (item.variantId && !variant) {
    return {
      ...item,
      status: "variant_missing",
      title: localizedTitle(product.content),
      totalCents: 0,
      unitPriceCents: 0,
      variantTitle: null
    };
  }

  const unitPriceCents = product.priceCents + (variant?.priceDeltaCents ?? 0);
  const isAvailable = current?.availability[product.id]?.isAvailable ?? true;
  return {
    ...item,
    status: isAvailable ? "available" : "product_unavailable",
    title: localizedTitle(product.content),
    totalCents: unitPriceCents * item.quantity,
    unitPriceCents,
    variantTitle: variant ? localizedTitle(variant.content) : null
  };
}

export class DinerDraftService {
  constructor(
    private readonly tableEntryService: Pick<TableEntryService, "resolve">,
    private readonly catalogRepository: Pick<CatalogRepository, "getCurrent">
  ) {}

  async recalculate(context: TenantHostContext, request: DinerDraftRequest) {
    const entry = await this.tableEntryService.resolve(context, request.token);
    if (entry.status !== "ok") return entry;

    const current = await this.catalogRepository.getCurrent({
      locationId: context.location.id,
      tenantId: context.tenant.id
    });
    const items = request.items.map((item) => quoteItem(item, current));
    const allItemsAvailable = items.every(
      ({ status }) => status === "available"
    );
    return {
      draft: {
        canConfirm:
          items.length > 0 && entry.entry.canConfirmOrder && allItemsAvailable,
        catalogRevision: current?.revision ?? null,
        items,
        totalCents: items.reduce((sum, item) => sum + item.totalCents, 0)
      },
      status: "ok" as const
    };
  }
}
