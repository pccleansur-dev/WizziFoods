import {
  parseBeginOnlinePaymentResult,
  parseOnlinePaymentView,
  parseProviderPaymentSnapshot,
  parseReconcileResult,
  parseTenantScope,
  type BeginOnlinePaymentResult,
  type OnlinePaymentView,
  type ProviderPaymentSnapshot,
  type ReconcileResult,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type SealedCredential = { ciphertext: Buffer; keyVersion: number };

export type StoredMercadoPagoCredential = SealedCredential & {
  liveMode: boolean;
  mpUserId: string;
  publicKey: string;
};

export type WebhookClaim = "duplicate" | "new" | "retry";

export type WebhookOutcome =
  | "amount_mismatch"
  | "applied"
  | "failed"
  | "ignored"
  | "needs_refund"
  | "stale"
  | "unchanged"
  | "unknown_seller";

export type PaymentNeedingRefund = {
  paymentId: string;
  providerPaymentId: string;
  remainingCents: number;
  scope: TenantScope;
};

export type PreparedOnlineRefund = {
  amountCents: number;
  paymentId: string;
  providerPaymentId: string;
};

export interface MercadoPagoRepository {
  beginOAuth(input: {
    requesterId: string;
    scope: TenantScope;
    stateHash: Buffer;
    ttlSeconds: number;
  }): Promise<string>;
  beginPayment(input: {
    intentId: string;
    scope: TenantScope;
    token: string;
  }): Promise<BeginOnlinePaymentResult>;
  claimWebhookEvent(input: {
    dataId: string;
    eventKey: string;
    scope: TenantScope | null;
    topic: string;
  }): Promise<WebhookClaim>;
  consumeOAuthState(
    stateHash: Buffer
  ): Promise<{ requesterId: string; scope: TenantScope }>;
  disconnect(input: { requesterId: string; scope: TenantScope }): Promise<void>;
  finishConnection(input: {
    liveMode: boolean;
    mpUserId: string;
    publicKey: string;
    requesterId: string;
    scope: TenantScope;
    sealed: SealedCredential;
  }): Promise<void>;
  finishWebhookEvent(eventKey: string, outcome: WebhookOutcome): Promise<void>;
  paymentView(input: {
    intentId: string;
    scope: TenantScope;
    token: string;
  }): Promise<OnlinePaymentView>;
  paymentsNeedingRefund(limit: number): Promise<PaymentNeedingRefund[]>;
  prepareRefund(input: {
    amountCents: number;
    paymentId: string;
    reason: string;
    scope: TenantScope;
    sessionId: string;
    staffId: string;
  }): Promise<PreparedOnlineRefund>;
  readCredentials(
    scope: TenantScope
  ): Promise<StoredMercadoPagoCredential | null>;
  reconcile(input: {
    paymentId: string;
    scope: TenantScope;
    snapshot: ProviderPaymentSnapshot;
  }): Promise<ReconcileResult>;
  replaceCredentials(
    scope: TenantScope,
    sealed: SealedCredential
  ): Promise<void>;
  resolveAccount(mpUserId: string): Promise<TenantScope | null>;
}

type ResultRow = { result: unknown };

const hashLength = 32;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertScope(value: TenantScope): TenantScope {
  const parsed = parseTenantScope(value);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertSealed(value: SealedCredential): SealedCredential {
  if (
    !Buffer.isBuffer(value.ciphertext) ||
    value.ciphertext.length < 29 ||
    value.ciphertext.length > 4096 ||
    !Number.isInteger(value.keyVersion) ||
    value.keyVersion < 1 ||
    value.keyVersion > 32_000
  ) {
    throw new Error("sealed credential must be canonical");
  }
  return value;
}

function assertHash(value: Buffer): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== hashLength) {
    throw new Error("oauth state hash must be 32 bytes");
  }
  return value;
}

function isoTimestamp(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function scopeFrom(value: unknown): TenantScope | null {
  const root = record(value);
  return root
    ? parseTenantScope({
        locationId: root.locationId,
        tenantId: root.tenantId
      })
    : null;
}

export function createMercadoPagoRepository(
  client: Sql
): MercadoPagoRepository {
  return {
    async beginOAuth(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<{ expiresAt: unknown }[]>`
        select private.begin_mp_oauth(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${assertHash(input.stateHash)}::bytea,
          ${input.ttlSeconds}::integer
        ) as "expiresAt"
      `;
      const expiresAt = isoTimestamp(row?.expiresAt);
      if (typeof expiresAt !== "string") {
        throw new Error("oauth expiry must be a timestamp");
      }
      return expiresAt;
    },

    async consumeOAuthState(stateHash) {
      const [row] = await client<ResultRow[]>`
        select private.consume_mp_oauth_state(
          ${assertHash(stateHash)}::bytea
        ) as result
      `;
      const root = record(row?.result);
      const scope = scopeFrom(root);
      if (!root || !scope || typeof root.requesterId !== "string") {
        throw new Error("oauth state result must be canonical");
      }
      return { requesterId: root.requesterId, scope };
    },

    async finishConnection(input) {
      const scope = assertScope(input.scope);
      const sealed = assertSealed(input.sealed);
      await client`
        select private.finish_mp_connection(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.mpUserId},
          ${input.liveMode}::boolean,
          ${input.publicKey},
          ${sealed.ciphertext}::bytea,
          ${sealed.keyVersion}::smallint
        )
      `;
    },

    async disconnect(input) {
      const scope = assertScope(input.scope);
      await client`
        select private.disconnect_mp(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid
        )
      `;
    },

    async readCredentials(scopeInput) {
      const scope = assertScope(scopeInput);
      const [row] = await client<ResultRow[]>`
        select private.read_mp_credentials(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid
        ) as result
      `;
      const root = record(row?.result);
      if (!root) return null;
      if (
        typeof root.ciphertext !== "string" ||
        typeof root.keyVersion !== "number" ||
        typeof root.liveMode !== "boolean" ||
        typeof root.mpUserId !== "string" ||
        typeof root.publicKey !== "string"
      ) {
        throw new Error("stored credential must be canonical");
      }
      return {
        ciphertext: Buffer.from(root.ciphertext, "base64"),
        keyVersion: root.keyVersion,
        liveMode: root.liveMode,
        mpUserId: root.mpUserId,
        publicKey: root.publicKey
      };
    },

    async replaceCredentials(scopeInput, sealedInput) {
      const scope = assertScope(scopeInput);
      const sealed = assertSealed(sealedInput);
      await client`
        select private.replace_mp_credentials(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${sealed.ciphertext}::bytea,
          ${sealed.keyVersion}::smallint
        )
      `;
    },

    async resolveAccount(mpUserId) {
      const [row] = await client<ResultRow[]>`
        select private.resolve_mp_account(${mpUserId}) as result
      `;
      return row?.result ? scopeFrom(row.result) : null;
    },

    async beginPayment(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.begin_diner_online_payment(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.token},
          ${input.intentId}::uuid
        ) as result
      `;
      const result = parseBeginOnlinePaymentResult(row?.result);
      if (!result) throw new Error("payment attempt must be canonical");
      return result;
    },

    async paymentView(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.diner_online_payment_view(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.token},
          ${input.intentId}::uuid
        ) as result
      `;
      const view = parseOnlinePaymentView(row?.result);
      if (!view) throw new Error("payment view must be canonical");
      return view;
    },

    async reconcile(input) {
      const scope = assertScope(input.scope);
      const snapshot = parseProviderPaymentSnapshot(input.snapshot);
      if (!snapshot) throw new Error("provider snapshot must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.reconcile_online_payment(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.paymentId}::uuid,
          ${snapshot.externalReference},
          ${snapshot.providerPaymentId},
          ${snapshot.status},
          ${snapshot.statusDetail},
          ${snapshot.amountCents}::integer,
          ${snapshot.refundedCents}::integer,
          ${snapshot.updatedAt}::timestamptz
        ) as result
      `;
      const result = parseReconcileResult(row?.result);
      if (!result) throw new Error("reconcile result must be canonical");
      return result;
    },

    async prepareRefund(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.prepare_online_refund(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.staffId}::uuid,
          ${input.sessionId}::uuid,
          ${input.paymentId}::uuid,
          ${input.amountCents}::integer,
          ${input.reason}
        ) as result
      `;
      const root = record(row?.result);
      if (
        !root ||
        typeof root.paymentId !== "string" ||
        typeof root.providerPaymentId !== "string" ||
        typeof root.amountCents !== "number"
      ) {
        throw new Error("refund preparation must be canonical");
      }
      return {
        amountCents: root.amountCents,
        paymentId: root.paymentId,
        providerPaymentId: root.providerPaymentId
      };
    },

    async paymentsNeedingRefund(limit) {
      const [row] = await client<ResultRow[]>`
        select private.online_payments_needing_refund(${limit}::integer) as result
      `;
      if (!Array.isArray(row?.result)) return [];
      const found: PaymentNeedingRefund[] = [];
      for (const value of row.result) {
        const item = record(value);
        const scope = scopeFrom(item);
        if (
          !item ||
          !scope ||
          typeof item.paymentId !== "string" ||
          typeof item.providerPaymentId !== "string" ||
          typeof item.remainingCents !== "number"
        ) {
          throw new Error("pending refund must be canonical");
        }
        found.push({
          paymentId: item.paymentId,
          providerPaymentId: item.providerPaymentId,
          remainingCents: item.remainingCents,
          scope
        });
      }
      return found;
    },

    async claimWebhookEvent(input) {
      const scope = input.scope ? assertScope(input.scope) : null;
      const [row] = await client<{ claim: string }[]>`
        select private.claim_mp_webhook_event(
          ${input.eventKey},
          ${scope?.tenantId ?? null}::uuid,
          ${scope?.locationId ?? null}::uuid,
          ${input.topic},
          ${input.dataId}
        ) as claim
      `;
      if (
        row?.claim !== "new" &&
        row?.claim !== "duplicate" &&
        row?.claim !== "retry"
      ) {
        throw new Error("webhook claim must be canonical");
      }
      return row.claim;
    },

    async finishWebhookEvent(eventKey, outcome) {
      await client`
        select private.finish_mp_webhook_event(${eventKey}, ${outcome})
      `;
    }
  };
}
