import {
  evaluateBusinessMediaUpload,
  parseTenantScope,
  type BusinessMediaKind,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type ReserveBusinessMediaInput = {
  byteLength: number;
  contentType: string;
  kind: BusinessMediaKind;
  requesterId: string;
  scope: TenantScope;
};

export type ReservedBusinessMedia = {
  contentType: string;
  expiresAt: string;
  id: string;
  kind: BusinessMediaKind;
  objectPath: string;
  sourceSizeBytes: number;
  status: "reserved";
};

export type CompleteBusinessMediaInput = {
  assetId: string;
  height: number;
  scope: TenantScope;
  sha256: string;
  storedSizeBytes: number;
  width: number;
};

export type CompletedBusinessMedia = {
  contentType: string;
  height: number;
  id: string;
  kind: BusinessMediaKind;
  objectPath: string;
  sha256: string;
  sourceSizeBytes: number;
  status: "ready";
  storedSizeBytes: number;
  width: number;
};

export type FailBusinessMediaInput = {
  assetId: string;
  scope: TenantScope;
};

export interface BusinessMediaRepository {
  complete(input: CompleteBusinessMediaInput): Promise<CompletedBusinessMedia>;
  fail(input: FailBusinessMediaInput): Promise<void>;
  reserve(input: ReserveBusinessMediaInput): Promise<ReservedBusinessMedia>;
}

type BusinessMediaRow = {
  content_type: string;
  id: string;
  kind: BusinessMediaKind;
  object_path: string;
  reservation_expires_at: Date;
  source_size_bytes: string | number;
  status: "reserved";
};

type CompletedBusinessMediaRow = Omit<
  BusinessMediaRow,
  "reservation_expires_at" | "status"
> & {
  height: number;
  sha256: string;
  status: "ready";
  stored_size_bytes: string | number;
  width: number;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createBusinessMediaRepository(
  client: Sql
): BusinessMediaRepository {
  return {
    async complete(input) {
      const scope = parseTenantScope(input.scope);
      if (!scope) throw new Error("tenant scope must be canonical");
      if (!uuidPattern.test(input.assetId)) {
        throw new Error("assetId must be a UUID");
      }
      if (
        !Number.isSafeInteger(input.storedSizeBytes) ||
        input.storedSizeBytes < 1 ||
        input.storedSizeBytes > 12 * 1024 * 1024 ||
        !Number.isSafeInteger(input.width) ||
        input.width < 1 ||
        input.width > 12000 ||
        !Number.isSafeInteger(input.height) ||
        input.height < 1 ||
        input.height > 12000 ||
        !/^[0-9a-f]{64}$/u.test(input.sha256)
      ) {
        throw new Error("processed business media metadata must be canonical");
      }

      const [row] = await client<CompletedBusinessMediaRow[]>`
        select *
        from private.complete_business_media_asset(
          ${scope.tenantId}::uuid,
          ${input.assetId}::uuid,
          ${input.storedSizeBytes}::bigint,
          ${input.width}::integer,
          ${input.height}::integer,
          ${input.sha256}
        )
      `;
      if (!row) throw new Error("Business media completion returned no record");
      return {
        contentType: row.content_type,
        height: row.height,
        id: row.id,
        kind: row.kind,
        objectPath: row.object_path,
        sha256: row.sha256,
        sourceSizeBytes: Number(row.source_size_bytes),
        status: row.status,
        storedSizeBytes: Number(row.stored_size_bytes),
        width: row.width
      };
    },
    async fail(input) {
      const scope = parseTenantScope(input.scope);
      if (!scope) throw new Error("tenant scope must be canonical");
      if (!uuidPattern.test(input.assetId)) {
        throw new Error("assetId must be a UUID");
      }
      await client`
        select private.fail_business_media_asset(
          ${scope.tenantId}::uuid,
          ${input.assetId}::uuid
        )
      `;
    },
    async reserve(input) {
      const scope = parseTenantScope(input.scope);
      if (!scope) throw new Error("tenant scope must be canonical");
      if (!uuidPattern.test(input.requesterId)) {
        throw new Error("requesterId must be a UUID");
      }
      if (!(["cover", "logo", "reference"] as string[]).includes(input.kind)) {
        throw new Error("business media kind must be canonical");
      }
      const decision = evaluateBusinessMediaUpload({
        byteLength: input.byteLength,
        contentType: input.contentType,
        currentTenantBytes: 0
      });
      if (!decision.accepted) {
        throw new Error("business media upload must be canonical");
      }

      const [row] = await client<BusinessMediaRow[]>`
        select *
        from private.reserve_business_media_asset(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.kind},
          ${input.contentType},
          ${input.byteLength}::bigint
        )
      `;
      if (!row)
        throw new Error("Business media reservation did not return a record");
      return {
        contentType: row.content_type,
        expiresAt: row.reservation_expires_at.toISOString(),
        id: row.id,
        kind: row.kind,
        objectPath: row.object_path,
        sourceSizeBytes: Number(row.source_size_bytes),
        status: row.status
      };
    }
  };
}
