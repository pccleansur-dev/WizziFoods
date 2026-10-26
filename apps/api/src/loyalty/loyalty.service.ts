import type {
  DinerBirthday,
  DinerLoyaltyView,
  LoyaltySettings,
  RedeemRewardRequest,
  RedeemRewardResult,
  ReleaseRewardRequest,
  ReleaseRewardResult,
  ReserveRewardRequest,
  ReserveRewardResult,
  SaveDinerBirthdayRequest,
  SessionReward,
  TenantScope
} from "@platform/contracts";
import type { LoyaltyRepository } from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

/**
 * Loyalty for the diner (account resolved from the diner session) and for the till
 * (staff session). Neither side can name a tenant, a location or an amount.
 */
export class LoyaltyService {
  constructor(private readonly loyalty: LoyaltyRepository) {}

  getDinerLoyalty(
    scope: TenantScope,
    accountId: string
  ): Promise<DinerLoyaltyView> {
    return this.loyalty.getDinerLoyalty({ accountId, scope });
  }

  saveBirthday(
    scope: TenantScope,
    accountId: string,
    request: SaveDinerBirthdayRequest
  ): Promise<DinerBirthday | null> {
    return this.loyalty.saveBirthday({ accountId, request, scope });
  }

  reserveReward(
    scope: TenantScope,
    accountId: string,
    request: ReserveRewardRequest
  ): Promise<ReserveRewardResult> {
    return this.loyalty.reserveReward({ accountId, request, scope });
  }

  releaseReward(
    scope: TenantScope,
    accountId: string,
    request: ReleaseRewardRequest
  ): Promise<ReleaseRewardResult> {
    return this.loyalty.releaseReward({ accountId, request, scope });
  }

  getSettings(context: StaffRequestContext): Promise<LoyaltySettings> {
    return this.loyalty.getSettings({
      scope: context.scope,
      staffId: context.staffId
    });
  }

  saveSettings(
    context: StaffRequestContext,
    settings: LoyaltySettings
  ): Promise<LoyaltySettings> {
    return this.loyalty.saveSettings({
      scope: context.scope,
      settings,
      staffId: context.staffId
    });
  }

  getSessionRewards(
    context: StaffRequestContext,
    sessionId: string
  ): Promise<SessionReward[]> {
    return this.loyalty.getSessionRewards({
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  redeemReward(
    context: StaffRequestContext,
    sessionId: string,
    request: RedeemRewardRequest
  ): Promise<RedeemRewardResult> {
    return this.loyalty.redeemReward({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }
}
