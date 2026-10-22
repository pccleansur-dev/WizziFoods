import { Injectable } from "@nestjs/common";
import type {
  SupportAccessGrant,
  SupportAccessRepository
} from "@platform/database";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";
import type {
  GrantSupportAccessRequest,
  RevokeSupportAccessRequest
} from "./support-access-input.js";

@Injectable()
export class SupportAccessService {
  constructor(
    private readonly supportAccessRepository: SupportAccessRepository
  ) {}

  grant(
    context: TenantAdminRequestContext,
    request: GrantSupportAccessRequest,
    correlationId: string
  ): Promise<SupportAccessGrant> {
    return this.supportAccessRepository.grant({
      correlationId,
      durationMinutes: request.durationMinutes,
      grantedBy: context.identity.userId,
      reason: request.reason,
      supportUserId: request.supportUserId,
      tenantId: context.scope.tenantId
    });
  }

  list(context: TenantAdminRequestContext): Promise<SupportAccessGrant[]> {
    return this.supportAccessRepository.list(
      context.scope.tenantId,
      context.identity.userId
    );
  }

  revoke(
    context: TenantAdminRequestContext,
    grantId: string,
    request: RevokeSupportAccessRequest,
    correlationId: string
  ): Promise<SupportAccessGrant> {
    return this.supportAccessRepository.revoke({
      correlationId,
      grantId,
      reason: request.reason,
      revokedBy: context.identity.userId,
      tenantId: context.scope.tenantId
    });
  }
}
