import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { parseBusinessMediaReservationRequest } from "./business-media-input.js";
import { BusinessMediaService } from "./business-media.service.js";

type BusinessMediaRequest = Pick<
  TenantAdminScopedRequest,
  "tenantAdminContext"
>;

@Controller("v1/tenant/business-media")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class BusinessMediaController {
  constructor(
    @Inject(BusinessMediaService)
    private readonly service: BusinessMediaService
  ) {}

  @Post("reservations")
  async reserve(@Req() request: BusinessMediaRequest, @Body() body: unknown) {
    let parsed;
    try {
      parsed = parseBusinessMediaReservationRequest(body);
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: "INVALID_BUSINESS_MEDIA",
          message: (error as Error).message
        }
      });
    }
    return {
      data: await this.service.reserve(request.tenantAdminContext, parsed)
    };
  }
}
