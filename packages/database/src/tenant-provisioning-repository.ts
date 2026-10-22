import { createHash } from "node:crypto";

import type {
  CreateTenantProvisioningRequest,
  TenantProvisioningStatus,
  TenantProvisioningView
} from "@platform/contracts";
import type { Sql } from "postgres";

export type BeginTenantProvisioningInput = {
  actorUserId: string;
  idempotencyKey: string;
  request: CreateTenantProvisioningRequest;
};

export type CompleteTenantProvisioningInput = {
  actorUserId: string;
  authUserId: string;
  requestId: string;
};

export type TenantProvisioningRecord = TenantProvisioningView & {
  authUserId: string | null;
};

export interface TenantProvisioningRepository {
  activateForIdentity(userId: string): Promise<boolean>;
  begin(input: BeginTenantProvisioningInput): Promise<TenantProvisioningRecord>;
  complete(
    input: CompleteTenantProvisioningInput
  ): Promise<TenantProvisioningRecord>;
}

type ProvisioningRow = {
  admin_email: string;
  auth_user_id: string | null;
  location_id: string;
  location_name: string;
  provisioning_status: TenantProvisioningStatus;
  request_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertUuid(value: string, label: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a UUID`);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mapRow(row: ProvisioningRow): TenantProvisioningRecord {
  return {
    adminEmail: row.admin_email,
    authUserId: row.auth_user_id,
    location: { id: row.location_id, name: row.location_name },
    requestId: row.request_id,
    status: row.provisioning_status,
    tenant: {
      id: row.tenant_id,
      name: row.tenant_name,
      slug: row.tenant_slug
    }
  };
}

export function createTenantProvisioningRepository(
  client: Sql
): TenantProvisioningRepository {
  return {
    async activateForIdentity(userId) {
      assertUuid(userId, "userId");
      const [row] = await client<{ activated: boolean }[]>`
        select private.activate_tenant_provisioning(${userId}::uuid) as activated
      `;
      return row?.activated ?? false;
    },

    async begin(input) {
      assertUuid(input.actorUserId, "actorUserId");
      if (
        input.idempotencyKey.length < 1 ||
        input.idempotencyKey.length > 255
      ) {
        throw new Error(
          "idempotencyKey must contain between 1 and 255 characters"
        );
      }

      const request = {
        adminEmail: input.request.adminEmail.trim().toLowerCase(),
        name: input.request.name.trim(),
        slug: input.request.slug.trim().toLowerCase()
      };
      const requestFingerprint = hash(
        JSON.stringify([request.slug, request.name, request.adminEmail])
      );
      const [row] = await client<ProvisioningRow[]>`
        select *
        from private.begin_tenant_provisioning(
          ${input.actorUserId}::uuid,
          ${hash(input.idempotencyKey)},
          ${requestFingerprint},
          ${request.slug},
          ${request.name},
          ${request.adminEmail}
        )
      `;

      if (!row) throw new Error("Tenant provisioning did not return a record");
      return mapRow(row);
    },

    async complete(input) {
      assertUuid(input.actorUserId, "actorUserId");
      assertUuid(input.authUserId, "authUserId");
      assertUuid(input.requestId, "requestId");

      const [row] = await client<ProvisioningRow[]>`
        select *
        from private.complete_tenant_provisioning(
          ${input.actorUserId}::uuid,
          ${input.requestId}::uuid,
          ${input.authUserId}::uuid
        )
      `;
      if (!row) {
        throw new Error(
          "Tenant provisioning completion did not return a record"
        );
      }
      return mapRow(row);
    }
  };
}
