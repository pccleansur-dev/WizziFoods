import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type {
  CatalogDraft,
  CatalogImportDraft,
  CatalogImportRequest
} from "@platform/contracts";
import type {
  CatalogImportRepository,
  CatalogRepository
} from "@platform/database";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";

function key(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

function mergeImportedDraft(
  current: CatalogDraft | null,
  imported: CatalogImportDraft
): CatalogDraft {
  const draft: CatalogDraft = current
    ? structuredClone(current)
    : { baseRevision: null, categories: [], products: [], sectors: [] };

  for (const item of imported.items) {
    let category = draft.categories.find(
      (candidate) =>
        key(candidate.content[0]?.title ?? "") === key(item.category.value)
    );
    if (!category) {
      if (draft.categories.length >= 50)
        throw new Error("catalog category limit exceeded");
      category = {
        content: [
          { description: "", language: "es", title: item.category.value }
        ],
        id: randomUUID(),
        position: draft.categories.length
      };
      draft.categories.push(category);
    }

    let sector = draft.sectors.find(
      (candidate) => key(candidate.name) === key(item.sector.value)
    );
    if (!sector) {
      if (draft.sectors.length >= 20)
        throw new Error("catalog sector limit exceeded");
      sector = {
        id: randomUUID(),
        kind: /bar|bebida|caf[eé]/iu.test(item.sector.value)
          ? "bar"
          : "kitchen",
        name: item.sector.value,
        position: draft.sectors.length
      };
      draft.sectors.push(sector);
    }

    const existingIndex = draft.products.findIndex(({ id }) => id === item.id);
    const product = {
      categoryId: category.id,
      content: [
        {
          description: item.description.value,
          language: "es",
          title: item.name.value
        }
      ],
      id: item.id,
      imageAssetId: null,
      position: existingIndex < 0 ? draft.products.length : existingIndex,
      priceCents: item.priceCents.value!,
      sectorId: sector.id,
      variants: []
    };
    if (existingIndex < 0) {
      if (draft.products.length >= 500)
        throw new Error("catalog product limit exceeded");
      draft.products.push(product);
    } else {
      draft.products[existingIndex] = product;
    }
  }
  return draft;
}

@Injectable()
export class CatalogImportService {
  constructor(
    private readonly imports: CatalogImportRepository,
    private readonly catalog: CatalogRepository
  ) {}

  enqueue(context: TenantAdminRequestContext, request: CatalogImportRequest) {
    return this.imports.enqueue({
      request,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  list(context: TenantAdminRequestContext) {
    return this.imports.list({
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  get(context: TenantAdminRequestContext, importId: string) {
    return this.imports.get({
      importId,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  discard(context: TenantAdminRequestContext, importId: string) {
    return this.imports.discard({
      importId,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  async approve(
    context: TenantAdminRequestContext,
    importId: string,
    reviewed: CatalogImportDraft
  ) {
    const current = await this.catalog.getDraft(
      context.scope,
      context.identity.userId
    );
    const draft = mergeImportedDraft(current?.draft ?? null, reviewed);
    const saved = await this.catalog.saveDraft({
      draft,
      requesterId: context.identity.userId,
      scope: context.scope
    });
    const imported = await this.imports.markApproved({
      draft: reviewed,
      importId,
      requesterId: context.identity.userId,
      scope: context.scope
    });
    return { catalogDraftRevision: saved.revision, import: imported };
  }
}
