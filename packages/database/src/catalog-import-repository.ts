import {
  parseCatalogImportDraft,
  parseCatalogImportRequest,
  parseTenantScope,
  type CatalogImportDraft,
  type CatalogImportRequest,
  type CatalogImportSource,
  type CatalogImportSourceKind,
  type CatalogImportStatus,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type CatalogImportRecord = {
  attemptCount: number;
  createdAt: string;
  draft: CatalogImportDraft | null;
  id: string;
  sourceKind: CatalogImportSourceKind;
  status: CatalogImportStatus;
  updatedAt: string;
};

export type CatalogImportClaim = {
  attemptCount: number;
  source: CatalogImportSource;
};

export type QueuedCatalogImportJob = {
  envelope: unknown;
  expectedScope: TenantScope;
  importStatus: CatalogImportStatus;
  messageId: string;
  readCount: number;
};

export interface CatalogImportRepository {
  ackJob(messageId: string): Promise<void>;
  claim(input: {
    importId: string;
    scope: TenantScope;
  }): Promise<CatalogImportClaim>;
  complete(input: {
    draft: CatalogImportDraft;
    importId: string;
    scope: TenantScope;
  }): Promise<CatalogImportRecord>;
  discard(input: {
    importId: string;
    requesterId: string;
    scope: TenantScope;
  }): Promise<CatalogImportRecord>;
  enqueue(input: {
    request: CatalogImportRequest;
    requesterId: string;
    scope: TenantScope;
  }): Promise<CatalogImportRecord>;
  fail(input: {
    importId: string;
    scope: TenantScope;
  }): Promise<CatalogImportRecord>;
  get(input: {
    importId: string;
    requesterId: string;
    scope: TenantScope;
  }): Promise<CatalogImportRecord>;
  list(input: {
    requesterId: string;
    scope: TenantScope;
  }): Promise<CatalogImportRecord[]>;
  markApproved(input: {
    draft: CatalogImportDraft;
    importId: string;
    requesterId: string;
    scope: TenantScope;
  }): Promise<CatalogImportRecord>;
  readJob(
    visibilityTimeoutSeconds: number
  ): Promise<QueuedCatalogImportJob | null>;
}

type ImportRow = {
  attempt_count: number;
  created_at: Date | string;
  draft: unknown;
  id: string;
  source_kind: CatalogImportSourceKind;
  status: CatalogImportStatus;
  updated_at: Date | string;
};

type ClaimRow = { attempt_count: number; source: unknown };
type JobRow = {
  envelope: unknown;
  expected_location_id: string;
  expected_tenant_id: string;
  import_status: CatalogImportStatus;
  message_id: number | string;
  read_count: number | string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function canonicalScope(scope: TenantScope): TenantScope {
  const parsed = parseTenantScope(scope);
  if (!parsed) throw new Error("catalog import scope must be canonical");
  return parsed;
}

function uuid(value: string, field: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${field} must be a UUID`);
}

function timestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf()))
    throw new Error("database timestamp must be valid");
  return parsed.toISOString();
}

function mapRow(row: ImportRow): CatalogImportRecord {
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0) {
    throw new Error("catalog import attempt count must be canonical");
  }
  const draft = row.draft === null ? null : parseCatalogImportDraft(row.draft);
  if (row.draft !== null && !draft)
    throw new Error("catalog import draft must be canonical");
  return {
    attemptCount: row.attempt_count,
    createdAt: timestamp(row.created_at),
    draft,
    id: row.id,
    sourceKind: row.source_kind,
    status: row.status,
    updatedAt: timestamp(row.updated_at)
  };
}

function assertMessageId(messageId: string): void {
  if (!/^[1-9][0-9]*$/u.test(messageId)) {
    throw new Error("messageId must be a positive integer");
  }
}

export function createCatalogImportRepository(
  client: Sql
): CatalogImportRepository {
  const adminArgs = (input: { requesterId: string; scope: TenantScope }) => {
    const scope = canonicalScope(input.scope);
    uuid(input.requesterId, "requesterId");
    return { scope };
  };

  return {
    async ackJob(messageId) {
      assertMessageId(messageId);
      const [row] = await client<{ acknowledged: boolean }[]>`
        select private.ack_catalog_import_job(${messageId}::bigint) as acknowledged
      `;
      if (!row?.acknowledged)
        throw new Error("Catalog import acknowledgement failed");
    },
    async claim(input) {
      const scope = canonicalScope(input.scope);
      uuid(input.importId, "importId");
      const [row] = await client<ClaimRow[]>`
        select * from private.claim_catalog_import(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.importId}::uuid
        )
      `;
      if (!row) throw new Error("Catalog import claim returned no record");
      const request = parseCatalogImportRequest({
        idempotencyKey: "00000000-0000-4000-8000-000000000000",
        source: row.source
      });
      if (!request) throw new Error("catalog import source must be canonical");
      return { attemptCount: row.attempt_count, source: request.source };
    },
    async complete(input) {
      const scope = canonicalScope(input.scope);
      uuid(input.importId, "importId");
      const draft = parseCatalogImportDraft(input.draft);
      if (!draft) throw new Error("catalog import draft must be canonical");
      const [row] = await client<ImportRow[]>`
        select * from private.complete_catalog_import(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.importId}::uuid,
          ${JSON.stringify(draft)}::jsonb
        )
      `;
      if (!row) throw new Error("Catalog import completion returned no record");
      return mapRow(row);
    },
    async discard(input) {
      const { scope } = adminArgs(input);
      uuid(input.importId, "importId");
      const [row] = await client<ImportRow[]>`
        select * from private.discard_catalog_import(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.importId}::uuid
        )
      `;
      if (!row) throw new Error("Catalog import discard returned no record");
      return mapRow(row);
    },
    async enqueue(input) {
      const { scope } = adminArgs(input);
      const request = parseCatalogImportRequest(input.request);
      if (!request) throw new Error("catalog import request must be canonical");
      const [row] = await client<ImportRow[]>`
        select * from private.enqueue_catalog_import(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${request.idempotencyKey}::uuid,
          ${request.source.kind},
          ${JSON.stringify(request.source)}::jsonb
        )
      `;
      if (!row) throw new Error("Catalog import enqueue returned no record");
      return mapRow(row);
    },
    async fail(input) {
      const scope = canonicalScope(input.scope);
      uuid(input.importId, "importId");
      const [row] = await client<ImportRow[]>`
        select * from private.fail_catalog_import(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.importId}::uuid
        )
      `;
      if (!row) throw new Error("Catalog import failure returned no record");
      return mapRow(row);
    },
    async get(input) {
      const { scope } = adminArgs(input);
      uuid(input.importId, "importId");
      const [row] = await client<ImportRow[]>`
        select * from private.get_catalog_import(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.importId}::uuid
        )
      `;
      if (!row) throw new Error("Catalog import does not exist");
      return mapRow(row);
    },
    async list(input) {
      const { scope } = adminArgs(input);
      const rows = await client<ImportRow[]>`
        select * from private.list_catalog_imports(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid
        )
      `;
      return rows.map(mapRow);
    },
    async markApproved(input) {
      const { scope } = adminArgs(input);
      uuid(input.importId, "importId");
      const draft = parseCatalogImportDraft(input.draft);
      if (!draft) throw new Error("catalog import draft must be canonical");
      const [row] = await client<ImportRow[]>`
        select * from private.approve_catalog_import(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.importId}::uuid,
          ${JSON.stringify(draft)}::jsonb
        )
      `;
      if (!row) throw new Error("Catalog import approval returned no record");
      return mapRow(row);
    },
    async readJob(visibilityTimeoutSeconds) {
      if (
        !Number.isSafeInteger(visibilityTimeoutSeconds) ||
        visibilityTimeoutSeconds < 1 ||
        visibilityTimeoutSeconds > 3600
      ) {
        throw new Error(
          "visibility timeout must be between 1 and 3600 seconds"
        );
      }
      const [row] = await client<JobRow[]>`
        select * from private.read_catalog_import_job(${visibilityTimeoutSeconds}::integer)
      `;
      if (!row) return null;
      const expectedScope = parseTenantScope({
        locationId: row.expected_location_id,
        tenantId: row.expected_tenant_id
      });
      if (!expectedScope)
        throw new Error("Queued catalog import scope is not canonical");
      const readCount = Number(row.read_count);
      if (!Number.isSafeInteger(readCount) || readCount < 1) {
        throw new Error("Queued catalog import read count is not canonical");
      }
      return {
        envelope: row.envelope,
        expectedScope,
        importStatus: row.import_status,
        messageId: String(row.message_id),
        readCount
      };
    }
  };
}
