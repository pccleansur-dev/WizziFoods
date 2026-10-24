import {
  parsePaymentMethodStatuses,
  parseTenantScope,
  type PaymentMethodKey,
  type PaymentMethodStatus,
  type PaymentPublicConfig,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

/** The credential as sealed by the API: ciphertext only, never plaintext. */
export type SealedPaymentSecret = {
  ciphertext: Uint8Array;
  keyVersion: number;
};

export type UpdatePaymentMethodInput = {
  enabled: boolean;
  method: PaymentMethodKey;
  publicConfig: PaymentPublicConfig | null;
  requesterId: string;
  scope: TenantScope;
};

export type StorePaymentSecretInput = {
  method: PaymentMethodKey;
  requesterId: string;
  scope: TenantScope;
  sealed: SealedPaymentSecret;
};

export type ClearPaymentSecretInput = {
  method: PaymentMethodKey;
  requesterId: string;
  scope: TenantScope;
};

export type PaymentReadiness = { availableMethods: number; ready: boolean };

/**
 * Every read returns state only. There is no method that returns a credential:
 * a future payment flow gets its own narrow, server-side accessor.
 */
export interface PaymentMethodsRepository {
  clearSecret(input: ClearPaymentSecretInput): Promise<PaymentMethodStatus[]>;
  getReadiness(scope: TenantScope): Promise<PaymentReadiness>;
  list(scope: TenantScope, requesterId: string): Promise<PaymentMethodStatus[]>;
  storeSecret(input: StorePaymentSecretInput): Promise<PaymentMethodStatus[]>;
  update(input: UpdatePaymentMethodInput): Promise<PaymentMethodStatus[]>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assertScope(scope: TenantScope): TenantScope {
  const parsed = parseTenantScope(scope);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertUuid(value: string, field: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${field} must be a UUID`);
}

function mapStatuses(value: unknown): PaymentMethodStatus[] {
  const statuses = parsePaymentMethodStatuses(value);
  if (!statuses) throw new Error("payment methods must be canonical");
  return statuses;
}

type ResultRow = { result: unknown };
type ReadinessRow = { available_methods: number };

export function createPaymentMethodsRepository(
  client: Sql
): PaymentMethodsRepository {
  return {
    async clearSecret(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      const [row] = await client<ResultRow[]>`
        select private.clear_payment_secret(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.method}
        ) as result
      `;
      return mapStatuses(row?.result);
    },

    async getReadiness(untrustedScope) {
      const scope = assertScope(untrustedScope);
      const [row] = await client<ReadinessRow[]>`
        select *
        from private.payment_readiness(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid
        )
      `;
      const availableMethods = row?.available_methods ?? 0;
      return { availableMethods, ready: availableMethods > 0 };
    },

    async list(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertUuid(requesterId, "requesterId");
      const [row] = await client<ResultRow[]>`
        select private.read_payment_methods(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        ) as result
      `;
      return mapStatuses(row?.result);
    },

    async storeSecret(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      if (
        !Number.isSafeInteger(input.sealed.keyVersion) ||
        input.sealed.keyVersion < 1 ||
        input.sealed.keyVersion > 32_000
      ) {
        throw new Error("keyVersion out of range");
      }
      const [row] = await client<ResultRow[]>`
        select private.store_payment_secret(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.method},
          ${Buffer.from(input.sealed.ciphertext)}::bytea,
          ${input.sealed.keyVersion}::smallint
        ) as result
      `;
      return mapStatuses(row?.result);
    },

    async update(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      const [row] = await client<ResultRow[]>`
        select private.update_payment_method(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.method},
          ${input.enabled},
          ${input.publicConfig === null ? null : JSON.stringify(input.publicConfig)}::jsonb
        ) as result
      `;
      return mapStatuses(row?.result);
    }
  };
}
