import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { parseBusinessProfileRequest } from "./business-profile-input.js";
import { BusinessProfileService } from "./business-profile.service.js";

type BusinessProfileRequest = Pick<
  TenantAdminScopedRequest,
  "tenantAdminContext"
>;

@Controller("v1/tenant/business-profile")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class BusinessProfileController {
  constructor(
    @Inject(BusinessProfileService)
    private readonly service: BusinessProfileService
  ) {}

  @Get()
  async get(@Req() request: BusinessProfileRequest) {
    return { data: await this.service.getDraft(request.tenantAdminContext) };
  }

  @Put()
  async save(@Req() request: BusinessProfileRequest, @Body() body: unknown) {
    let parsed;
    try {
      parsed = parseBusinessProfileRequest(body);
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: "INVALID_BUSINESS_PROFILE",
          message: (error as Error).message
        }
      });
    }
    return {
      data: await this.service.saveDraft(request.tenantAdminContext, parsed)
    };
  }
}
