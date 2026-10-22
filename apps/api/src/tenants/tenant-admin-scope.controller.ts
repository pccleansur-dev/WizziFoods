import { Controller, Get, Req, UseGuards } from "@nestjs/common";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "./tenant-admin-scope.guard.js";
import { TenantHostGuard } from "./tenant-host.guard.js";

@Controller("v1/tenant/context")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class TenantAdminScopeController {
  @Get()
  getContext(
    @Req() request: Pick<TenantAdminScopedRequest, "tenantAdminContext">
  ) {
    const context = request.tenantAdminContext;
    return {
      data: {
        domain: { hostname: context.domain.hostname },
        location: context.location,
        role: context.role,
        scope: context.scope,
        tenant: context.tenant
      }
    };
  }
}
