import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";

import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest
} from "../auth/admin-auth.guard.js";
import { TenantContextService } from "./tenant-context.service.js";

@Controller("v1/me/access")
@UseGuards(AdminAuthGuard)
export class TenantContextController {
  constructor(
    @Inject(TenantContextService)
    private readonly tenantContextService: TenantContextService
  ) {}

  @Get()
  async getAccess(
    @Req() request: Pick<AdminAuthenticatedRequest, "adminIdentity">
  ) {
    const identity = request.adminIdentity;
    const access = await this.tenantContextService.getForAuthenticatedIdentity(
      identity.userId,
      identity.sessionId
    );

    return {
      data: {
        access,
        identity: {
          assuranceLevel: identity.assuranceLevel,
          userId: identity.userId
        }
      }
    };
  }
}
