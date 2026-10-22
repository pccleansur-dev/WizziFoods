import { Controller, Get, Req, UseGuards } from "@nestjs/common";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "./tenant-host.guard.js";

@Controller("v1/public/tenant-context")
@UseGuards(TenantHostGuard)
export class TenantHostController {
  @Get()
  getContext(@Req() request: Pick<TenantHostRequest, "tenantHostContext">) {
    const context = request.tenantHostContext;

    return {
      data: {
        domain: { hostname: context.domain.hostname },
        location: { name: context.location.name },
        tenant: {
          name: context.tenant.name,
          slug: context.tenant.slug
        }
      }
    };
  }
}
