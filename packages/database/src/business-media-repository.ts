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

export interface BusinessMediaRepository {
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createBusinessMediaRepository(
  client: Sql
): BusinessMediaRepository {
  return {
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
