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

import {
  parseGoogleReviewUrl,
  parseOrderServiceHours
} from "@platform/contracts";

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

  @Get("google-review")
  async googleReview(@Req() request: BusinessProfileRequest) {
    return {
      data: await this.service.googleReviewLink(request.tenantAdminContext)
    };
  }

  @Put("google-review")
  async saveGoogleReview(
    @Req() request: BusinessProfileRequest,
    @Body() body: { url?: unknown } | null
  ) {
    const url = body?.url === null ? null : parseGoogleReviewUrl(body?.url);
    if (!url && body?.url !== null)
      throw new BadRequestException(
        "Pegá un enlace de reseñas de Google válido."
      );
    return {
      data: await this.service.googleReviewLink(request.tenantAdminContext, url)
    };
  }

  @Get("order-hours")
  async orderHours(@Req() request: BusinessProfileRequest) {
    return { data: await this.service.orderHours(request.tenantAdminContext) };
  }

  @Put("order-hours")
  async saveOrderHours(
    @Req() request: BusinessProfileRequest,
    @Body() body: unknown
  ) {
    const settings = parseOrderServiceHours(body);
    if (!settings)
      throw new BadRequestException("Revisá los horarios de pedidos.");
    return {
      data: await this.service.orderHours(request.tenantAdminContext, settings)
    };
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
