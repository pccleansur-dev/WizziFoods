import {
  parseCatalogDraft,
  parseTenantScope,
  type CatalogDraft,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type CatalogDraftRecord = {
  basePublishedRevision: number | null;
  draft: CatalogDraft;
  isDirty: boolean;
  revision: number;
  updatedAt: string;
};

export type CatalogAvailability = {
  isAvailable: boolean;
  version: number;
};

export type PublishedCatalogRecord = {
  availability: Record<string, CatalogAvailability>;
  catalog: CatalogDraft;
  publishedAt: string;
  revision: number;
};

export type CatalogPublicationRecord = {
  catalog: CatalogDraft;
  publishedAt: string;
  revision: number;
  sourceDraftRevision: number;
};

export type SaveCatalogDraftInput = {
  draft: CatalogDraft;
  requesterId: string;
  scope: TenantScope;
};

export type PublishCatalogInput = {
  expectedDraftRevision: number;
  requesterId: string;
  scope: TenantScope;
};

export type SetCatalogAvailabilityInput = {
  expectedVersion: number | null;
  isAvailable: boolean;
  productId: string;
  requesterId: string;
  scope: TenantScope;
};

export interface CatalogRepository {
  getCurrent(scope: TenantScope): Promise<PublishedCatalogRecord | null>;
  getDraft(
    scope: TenantScope,
    requesterId: string
  ): Promise<CatalogDraftRecord | null>;
  publish(input: PublishCatalogInput): Promise<CatalogPublicationRecord>;
  saveDraft(input: SaveCatalogDraftInput): Promise<CatalogDraftRecord>;
  setAvailability(
    input: SetCatalogAvailabilityInput
  ): Promise<CatalogAvailability>;
}

type CatalogDraftRow = {
  base_published_revision: number | null;
  is_dirty: boolean;
  revision: number;
  snapshot: unknown;
  updated_at: Date | string;
};

type PublishedCatalogRow = {
  availability: unknown;
  published_at: Date | string;
  revision: number;
  snapshot: unknown;
};

type CatalogPublicationRow = {
  published_at: Date | string;
  revision: number;
  snapshot: unknown;
  source_draft_revision: number;
};

type CatalogAvailabilityRow = {
  is_available: boolean;
  version: number;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertScope(scope: TenantScope): TenantScope {
  const parsed = parseTenantScope(scope);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertUuid(value: string, field: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${field} must be a UUID`);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertDraft(value: unknown): CatalogDraft {
  const parsed = parseCatalogDraft(value);
  if (!parsed) throw new Error("catalog draft must be canonical");
  return parsed;
}

function toIsoTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("database timestamp must be valid");
  }
  return timestamp.toISOString();
}

function mapDraftRow(row: CatalogDraftRow): CatalogDraftRecord {
  const draft = assertDraft(row.snapshot);
  if (draft.baseRevision !== row.base_published_revision) {
    throw new Error("catalog draft base revision is inconsistent");
  }
  assertPositiveInteger(row.revision, "catalog draft revision");
  return {
    basePublishedRevision: row.base_published_revision,
    draft,
    isDirty: row.is_dirty,
    revision: row.revision,
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function parseAvailability(
  value: unknown
): Record<string, CatalogAvailability> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("catalog availability must be an object");
  }
  const availability: Record<string, CatalogAvailability> = {};
  for (const [productId, rawStatus] of Object.entries(value)) {
    assertUuid(productId, "availability productId");
    if (
      typeof rawStatus !== "object" ||
      rawStatus === null ||
      Array.isArray(rawStatus) ||
      Object.keys(rawStatus).sort().join() !== "isAvailable,version"
    ) {
      throw new Error("catalog availability status must be canonical");
    }
    const status = rawStatus as Record<string, unknown>;
    if (typeof status.isAvailable !== "boolean") {
      throw new Error("catalog availability status must be canonical");
    }
    assertPositiveInteger(
      status.version as number,
      "catalog availability version"
    );
    availability[productId] = {
      isAvailable: status.isAvailable,
      version: status.version as number
    };
  }
  return availability;
}

export function createCatalogRepository(client: Sql): CatalogRepository {
  return {
    async getCurrent(untrustedScope) {
      const scope = assertScope(untrustedScope);
      const [row] = await client<PublishedCatalogRow[]>`
        select *
        from private.get_current_catalog(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid
        )
      `;
      if (!row) return null;
      assertPositiveInteger(row.revision, "published catalog revision");
      return {
        availability: parseAvailability(row.availability),
        catalog: assertDraft(row.snapshot),
        publishedAt: toIsoTimestamp(row.published_at),
        revision: row.revision
      };
    },

    async getDraft(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertUuid(requesterId, "requesterId");
      const [row] = await client<CatalogDraftRow[]>`
        select *
        from private.get_catalog_draft(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        )
      `;
      return row ? mapDraftRow(row) : null;
    },

    async publish(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      assertPositiveInteger(
        input.expectedDraftRevision,
        "expectedDraftRevision"
      );
      const [row] = await client<CatalogPublicationRow[]>`
        select *
        from private.publish_catalog(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.expectedDraftRevision}
        )
      `;
      if (!row) throw new Error("Catalog publication did not return a record");
      assertPositiveInteger(row.revision, "published catalog revision");
      assertPositiveInteger(row.source_draft_revision, "source draft revision");
      return {
        catalog: assertDraft(row.snapshot),
        publishedAt: toIsoTimestamp(row.published_at),
        revision: row.revision,
        sourceDraftRevision: row.source_draft_revision
      };
    },

    async saveDraft(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      const draft = assertDraft(input.draft);
      const [row] = await client<CatalogDraftRow[]>`
        select *
        from private.save_catalog_draft(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${JSON.stringify(draft)}::jsonb
        )
      `;
      if (!row) throw new Error("Catalog draft save did not return a record");
      return mapDraftRow(row);
    },

    async setAvailability(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      assertUuid(input.productId, "productId");
      if (typeof input.isAvailable !== "boolean") {
        throw new Error("isAvailable must be a boolean");
      }
      if (input.expectedVersion !== null) {
        if (
          !Number.isSafeInteger(input.expectedVersion) ||
          input.expectedVersion <= 0
        ) {
          throw new Error("expectedVersion must be null or a positive integer");
        }
      }
      const [row] = await client<CatalogAvailabilityRow[]>`
        select *
        from private.set_catalog_product_availability(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.productId}::uuid,
          ${input.isAvailable},
          ${input.expectedVersion}
        )
      `;
      if (!row) throw new Error("Availability update did not return a record");
      assertPositiveInteger(row.version, "catalog availability version");
      return { isAvailable: row.is_available, version: row.version };
    }
  };
}
