import {
  parseDinerBirthday,
  parseDinerLoyaltyView,
  parseLoyaltySettings,
  parseRedeemRewardRequest,
  parseRedeemRewardResult,
  parseReleaseRewardRequest,
  parseReleaseRewardResult,
  parseReserveRewardRequest,
  parseReserveRewardResult,
  parseSaveDinerBirthdayRequest,
  parseSessionRewards,
  parseTenantScope,
  type DinerBirthday,
  type DinerLoyaltyView,
  type LoyaltySettings,
  type RedeemRewardRequest,
  type RedeemRewardResult,
  type ReleaseRewardRequest,
  type ReleaseRewardResult,
  type ReserveRewardRequest,
  type ReserveRewardResult,
  type SaveDinerBirthdayRequest,
  type SessionReward,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StaffScope = { scope: TenantScope; staffId: string };
type DinerTarget = { accountId: string; scope: TenantScope };

/**
 * Visits, birthday and rewards. The diner side takes the account the API resolved from
 * the session; the staff side takes the staff member of the till. Every amount is
 * computed in the database, and the redemption (discount + payment + reward) is a
 * single database call.
 */
export interface LoyaltyRepository {
  getDinerLoyalty(input: DinerTarget): Promise<DinerLoyaltyView>;
  getSettings(input: StaffScope): Promise<LoyaltySettings>;
  getSessionRewards(
    input: StaffScope & { sessionId: string }
  ): Promise<SessionReward[]>;
  redeemReward(
    input: StaffScope & { request: RedeemRewardRequest; sessionId: string }
  ): Promise<RedeemRewardResult>;
  releaseReward(
    input: DinerTarget & { request: ReleaseRewardRequest }
  ): Promise<ReleaseRewardResult>;
  reserveReward(
    input: DinerTarget & { request: ReserveRewardRequest }
  ): Promise<ReserveRewardResult>;
  saveBirthday(
    input: DinerTarget & { request: SaveDinerBirthdayRequest }
  ): Promise<DinerBirthday | null>;
  saveSettings(
    input: StaffScope & { settings: LoyaltySettings }
  ): Promise<LoyaltySettings>;
}

type ResultRow = { result: unknown };

function uuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a uuid`);
  return value;
}

function scopeOf(value: TenantScope): TenantScope {
  const parsed = parseTenantScope(value);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function canonical<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label} must be canonical`);
  return value;
}

export function createLoyaltyRepository(client: Sql): LoyaltyRepository {
  return {
    async getDinerLoyalty(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.get_diner_loyalty(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.accountId, "account id")}::uuid
        ) as result
      `;
      return canonical(parseDinerLoyaltyView(row?.result), "loyalty view");
    },

    async getSettings(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.get_loyalty_settings(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid
        ) as result
      `;
      return canonical(parseLoyaltySettings(row?.result), "loyalty settings");
    },

    async getSessionRewards(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.session_loyalty_rewards(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${uuid(input.sessionId, "session id")}::uuid
        ) as result
      `;
      return canonical(parseSessionRewards(row?.result), "session rewards");
    },

    async redeemReward(input) {
      const scope = scopeOf(input.scope);
      const request = canonical(
        parseRedeemRewardRequest(input.request),
        "redeem request"
      );
      const [row] = await client<ResultRow[]>`
        select private.redeem_loyalty_reward_with_payment(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${request.commandId}::uuid,
          ${uuid(input.sessionId, "session id")}::uuid,
          ${request.rewardId}::uuid,
          ${request.method}::text,
          ${request.tipCents}::integer
        ) as result
      `;
      return canonical(parseRedeemRewardResult(row?.result), "redeem result");
    },

    async releaseReward(input) {
      const scope = scopeOf(input.scope);
      const request = canonical(
        parseReleaseRewardRequest(input.request),
        "release request"
      );
      const [row] = await client<ResultRow[]>`
        select private.release_loyalty_reward(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.accountId, "account id")}::uuid,
          ${request.rewardId}::uuid
        ) as result
      `;
      return canonical(parseReleaseRewardResult(row?.result), "release result");
    },

    async reserveReward(input) {
      const scope = scopeOf(input.scope);
      const request = canonical(
        parseReserveRewardRequest(input.request),
        "reserve request"
      );
      const [row] = await client<ResultRow[]>`
        select private.reserve_loyalty_reward(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.accountId, "account id")}::uuid,
          ${request.rewardId}::uuid, ${request.sessionId}::uuid
        ) as result
      `;
      return canonical(parseReserveRewardResult(row?.result), "reserve result");
    },

    async saveBirthday(input) {
      const scope = scopeOf(input.scope);
      const request = canonical(
        parseSaveDinerBirthdayRequest(input.request),
        "birthday request"
      );
      const [row] = await client<ResultRow[]>`
        select private.save_diner_birthday(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.accountId, "account id")}::uuid,
          ${request.month}::integer, ${request.day}::integer
        ) as result
      `;
      return parseDinerBirthday(row?.result);
    },

    async saveSettings(input) {
      const scope = scopeOf(input.scope);
      const settings = canonical(
        parseLoyaltySettings(input.settings),
        "loyalty settings"
      );
      const [row] = await client<ResultRow[]>`
        select private.save_loyalty_settings(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${JSON.stringify(settings)}::text::jsonb
        ) as result
      `;
      return canonical(parseLoyaltySettings(row?.result), "loyalty settings");
    }
  };
}
