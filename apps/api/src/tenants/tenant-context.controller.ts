import { Controller, Get, Req, UseGuards } from "@nestjs/common";

import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest
} from "../auth/admin-auth.guard.js";
import { TenantContextService } from "./tenant-context.service.js";

@Controller("v1/me/tenant-context")
@UseGuards(AdminAuthGuard)
export class TenantContextController {
  constructor(private readonly tenantContextService: TenantContextService) {}

  @Get()
  async getTenantContext(
    @Req() request: Pick<AdminAuthenticatedRequest, "adminIdentity">
  ) {
    const identity = request.adminIdentity;
    const tenantContexts =
      await this.tenantContextService.getForAuthenticatedIdentity(
        identity.userId
      );

    return { data: { identity, tenantContexts } };
  }
}
