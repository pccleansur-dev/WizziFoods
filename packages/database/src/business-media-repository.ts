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

export type QueueBusinessMediaInput = {
  assetId: string;
  requesterId: string;
  scope: TenantScope;
};

export type BusinessMediaProcessingRecord = {
  id: string;
  processingMessageId: string;
  status: "deleted" | "failed" | "ready" | "reserved";
};

export type ClaimBusinessMediaInput = {
  assetId: string;
  scope: TenantScope;
};

export type ClaimedBusinessMedia = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  kind: BusinessMediaKind;
  objectPath: string;
};

export type QueuedBusinessMediaJob = {
  envelope: unknown;
  expectedScope: TenantScope;
  messageId: string;
};

export interface BusinessMediaRepository {
  ackJob(messageId: string): Promise<void>;
  claim(input: ClaimBusinessMediaInput): Promise<ClaimedBusinessMedia>;
  complete(input: CompleteBusinessMediaInput): Promise<CompletedBusinessMedia>;
  fail(input: FailBusinessMediaInput): Promise<void>;
  queue(input: QueueBusinessMediaInput): Promise<BusinessMediaProcessingRecord>;
  readJob(visibilityTimeoutSeconds: number): Promise<QueuedBusinessMediaJob | null>;
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

type BusinessMediaProcessingRow = {
  id: string;
  processing_message_id: number | string;
  status: BusinessMediaProcessingRecord["status"];
};

type ClaimedBusinessMediaRow = {
  content_type: ClaimedBusinessMedia["contentType"];
  kind: BusinessMediaKind;
  object_path: string;
};

type QueuedBusinessMediaJobRow = {
  envelope: unknown;
  expected_location_id: string;
  expected_tenant_id: string;
  message_id: number | string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createBusinessMediaRepository(
  client: Sql
): BusinessMediaRepository {
  return {
    async ackJob(messageId) {
      if (!/^[1-9][0-9]*$/u.test(messageId)) {
        throw new Error("messageId must be a positive integer");
      }
      const [row] = await client<{ acknowledged: boolean }[]>`
        select private.ack_business_media_job(
          ${messageId}::bigint
        ) as acknowledged
      `;
      if (!row?.acknowledged) {
        throw new Error("Business media job acknowledgement failed");
      }
    },
    async claim(input) {
      const scope = parseTenantScope(input.scope);
      if (!scope) throw new Error("tenant scope must be canonical");
      if (!uuidPattern.test(input.assetId)) {
        throw new Error("assetId must be a UUID");
      }
      const [row] = await client<ClaimedBusinessMediaRow[]>`
        select *
        from private.claim_business_media_asset(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.assetId}::uuid
        )
      `;
      if (!row) throw new Error("Business media claim returned no record");
      return {
        contentType: row.content_type,
        kind: row.kind,
        objectPath: row.object_path
      };
    },
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
    async queue(input) {
      const scope = parseTenantScope(input.scope);
      if (!scope) throw new Error("tenant scope must be canonical");
      if (!uuidPattern.test(input.assetId)) {
        throw new Error("assetId must be a UUID");
      }
      if (!uuidPattern.test(input.requesterId)) {
        throw new Error("requesterId must be a UUID");
      }
      const [row] = await client<BusinessMediaProcessingRow[]>`
        select *
        from private.enqueue_business_media_processing(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.assetId}::uuid
        )
      `;
      if (!row?.processing_message_id) {
        throw new Error("Business media queueing returned no record");
      }
      return {
        id: row.id,
        processingMessageId: String(row.processing_message_id),
        status: row.status
      };
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
      const [row] = await client<QueuedBusinessMediaJobRow[]>`
        select *
        from private.read_business_media_job(
          ${visibilityTimeoutSeconds}::integer
        )
      `;
      if (!row) return null;
      const expectedScope = parseTenantScope({
        locationId: row.expected_location_id,
        tenantId: row.expected_tenant_id
      });
      if (!expectedScope) {
        throw new Error("Queued business media scope is not canonical");
      }
      return {
        envelope: row.envelope,
        expectedScope,
        messageId: String(row.message_id)
      };
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
