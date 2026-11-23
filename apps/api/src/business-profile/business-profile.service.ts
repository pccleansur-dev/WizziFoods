import { Injectable } from "@nestjs/common";
import type {
  BusinessProfileDraft,
  OrderServiceHours
} from "@platform/contracts";
import type {
  BusinessProfileDraftRecord,
  BusinessProfileRepository
} from "@platform/database";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";

@Injectable()
export class BusinessProfileService {
  constructor(
    private readonly businessProfileRepository: BusinessProfileRepository
  ) {}

  orderHours(context: TenantAdminRequestContext, settings?: OrderServiceHours) {
    return this.businessProfileRepository.orderHours(
      context.scope,
      context.identity.userId,
      settings
    );
  }

  getDraft(
    context: TenantAdminRequestContext
  ): Promise<BusinessProfileDraftRecord | null> {
    return this.businessProfileRepository.getDraft(
      context.scope,
      context.identity.userId
    );
  }

  saveDraft(
    context: TenantAdminRequestContext,
    draft: BusinessProfileDraft
  ): Promise<BusinessProfileDraftRecord> {
    return this.businessProfileRepository.saveDraft({
      draft,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }
}
