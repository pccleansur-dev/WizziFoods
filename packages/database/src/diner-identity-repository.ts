import {
  parseDinerConsentRequest,
  parseDinerExport,
  parseDinerProfileView,
  parseDinerSessionLinkRequest,
  parseDinerSessionLinkResult,
  parseSaveDinerProfileRequest,
  parseTenantScope,
  type DinerConsentRequest,
  type DinerExport,
  type DinerProfileView,
  type DinerSessionLinkResult,
  type SaveDinerProfileRequest,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Optional diner accounts. Tokens and codes arrive already hashed (SHA-256); the
 * Google `sub` arrives already keyed-hashed. The restaurant is always the tenant of
 * the host; accounts are global and never leave this repository as an id the
 * browser can send.
 */
export interface DinerIdentityRepository {
  anonymize(accountId: string): Promise<Date>;
  createLoginExchange(input: {
    accountId: string;
    codeHash: Buffer;
    tenantId: string;
  }): Promise<void>;
  export(accountId: string): Promise<DinerExport>;
  getProfile(input: {
    accountId: string;
    tenantId: string;
  }): Promise<DinerProfileView>;
  linkToSession(input: {
    accountId: string;
    scope: TenantScope;
    token: string;
  }): Promise<DinerSessionLinkResult>;
  recordConsent(input: {
    accountId: string;
    request: DinerConsentRequest;
    tenantId: string;
  }): Promise<DinerProfileView>;
  redeemLogin(input: {
    codeHash: Buffer;
    sessionHash: Buffer;
    tenantId: string;
  }): Promise<string | null>;
  resolveSession(input: {
    tenantId: string;
    tokenHash: Buffer;
  }): Promise<string | null>;
  revokeSession(input: { tenantId: string; tokenHash: Buffer }): Promise<void>;
  saveProfile(input: {
    accountId: string;
    request: SaveDinerProfileRequest;
    tenantId: string;
  }): Promise<DinerProfileView>;
  upsertAccount(input: { email: string; subHash: string }): Promise<string>;
}

type ResultRow = { result: unknown };

function uuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a uuid`);
  return value;
}

function sha256(value: Buffer, label: string): Buffer {
  if (value.length !== 32) throw new Error(`${label} must be a SHA-256 digest`);
  return value;
}

export function createDinerIdentityRepository(
  client: Sql
): DinerIdentityRepository {
  async function view(
    query: Promise<ResultRow[]>,
    label: string
  ): Promise<DinerProfileView> {
    const [row] = await query;
    const parsed = parseDinerProfileView(row?.result);
    if (!parsed) throw new Error(`${label} must be canonical`);
    return parsed;
  }

  return {
    async anonymize(accountId) {
      const [row] = await client<ResultRow[]>`
        select private.anonymize_diner_account(
          ${uuid(accountId, "account id")}::uuid
        ) as result
      `;
      const at = (row?.result as { anonymizedAt?: unknown } | undefined)
        ?.anonymizedAt;
      if (typeof at !== "string" && !(at instanceof Date)) {
        throw new Error("anonymization result must be canonical");
      }
      return new Date(at);
    },

    async createLoginExchange(input) {
      await client`
        select private.create_diner_login_exchange(
          ${uuid(input.accountId, "account id")}::uuid,
          ${uuid(input.tenantId, "tenant id")}::uuid,
          ${sha256(input.codeHash, "code hash")}::bytea
        )
      `;
    },

    async export(accountId) {
      const [row] = await client<ResultRow[]>`
        select private.export_diner_data(
          ${uuid(accountId, "account id")}::uuid
        ) as result
      `;
      const parsed = parseDinerExport(row?.result);
      if (!parsed) throw new Error("export must be canonical");
      return parsed;
    },

    getProfile(input) {
      return view(
        client<ResultRow[]>`
          select private.get_diner_profile(
            ${uuid(input.tenantId, "tenant id")}::uuid,
            ${uuid(input.accountId, "account id")}::uuid
          ) as result
        `,
        "profile"
      );
    },

    async linkToSession(input) {
      const scope = parseTenantScope(input.scope);
      const request = parseDinerSessionLinkRequest({ token: input.token });
      if (!scope || !request) throw new Error("link request must be canonical");
      const [row] = await client<ResultRow[]>`
        select private.link_diner_to_session(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${uuid(input.accountId, "account id")}::uuid,
          ${request.token}::text
        ) as result
      `;
      const parsed = parseDinerSessionLinkResult(row?.result);
      if (!parsed) throw new Error("link result must be canonical");
      return parsed;
    },

    recordConsent(input) {
      const request = parseDinerConsentRequest(input.request);
      if (!request) throw new Error("consent request must be canonical");
      return view(
        client<ResultRow[]>`
          select private.record_diner_consent(
            ${uuid(input.tenantId, "tenant id")}::uuid,
            ${uuid(input.accountId, "account id")}::uuid,
            ${request.commandId}::uuid,
            ${request.kind}::text,
            ${request.action}::text,
            ${request.textVersion}::integer,
            ${request.source}::text
          ) as result
        `,
        "consent result"
      );
    },

    async redeemLogin(input) {
      const [row] = await client<Array<{ account_id: string | null }>>`
        select private.redeem_diner_login(
          ${uuid(input.tenantId, "tenant id")}::uuid,
          ${sha256(input.codeHash, "code hash")}::bytea,
          ${sha256(input.sessionHash, "session hash")}::bytea
        ) as account_id
      `;
      return row?.account_id ?? null;
    },

    async resolveSession(input) {
      const [row] = await client<Array<{ account_id: string | null }>>`
        select private.resolve_diner_session(
          ${uuid(input.tenantId, "tenant id")}::uuid,
          ${sha256(input.tokenHash, "token hash")}::bytea
        ) as account_id
      `;
      return row?.account_id ?? null;
    },

    async revokeSession(input) {
      await client`
        select private.revoke_diner_session(
          ${uuid(input.tenantId, "tenant id")}::uuid,
          ${sha256(input.tokenHash, "token hash")}::bytea
        )
      `;
    },

    saveProfile(input) {
      const request = parseSaveDinerProfileRequest(input.request);
      if (!request) throw new Error("profile request must be canonical");
      return view(
        client<ResultRow[]>`
          select private.save_diner_profile(
            ${uuid(input.tenantId, "tenant id")}::uuid,
            ${uuid(input.accountId, "account id")}::uuid,
            ${request.displayName}::text,
            ${request.whatsappPhone}::text
          ) as result
        `,
        "profile"
      );
    },

    async upsertAccount(input) {
      if (!/^[0-9a-f]{64}$/u.test(input.subHash)) {
        throw new Error("sub hash must be a SHA-256 hex digest");
      }
      const [row] = await client<Array<{ id: string }>>`
        select private.upsert_diner_account(
          ${input.subHash}::text,
          ${input.email}::text
        ) as id
      `;
      if (!row) throw new Error("account must be created");
      return row.id;
    }
  };
}
