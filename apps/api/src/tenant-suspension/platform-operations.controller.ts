import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";

import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest
} from "../auth/admin-auth.guard.js";
import { TenantSuspensionService } from "./tenant-suspension.service.js";

@Controller("v1/platform/operations")
@UseGuards(AdminAuthGuard)
export class PlatformOperationsController {
  constructor(
    @Inject(TenantSuspensionService)
    private readonly service: TenantSuspensionService
  ) {}

  @Get()
  async overview(
    @Req() request: Pick<AdminAuthenticatedRequest, "adminIdentity">
  ) {
    return { data: await this.service.overview(request.adminIdentity) };
  }
}
