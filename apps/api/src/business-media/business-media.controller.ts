import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
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
import {
  parseBusinessMediaAssetId,
  parseBusinessMediaReservationRequest
} from "./business-media-input.js";
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

  @Get(":assetId")
  async getStatus(
    @Req() request: BusinessMediaRequest,
    @Param("assetId") assetId: unknown
  ) {
    let parsed;
    try {
      parsed = parseBusinessMediaAssetId(assetId);
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: "INVALID_BUSINESS_MEDIA",
          message: (error as Error).message
        }
      });
    }
    return {
      data: await this.service.getStatus(request.tenantAdminContext, parsed)
    };
  }

  @Post(":assetId/processing")
  @HttpCode(HttpStatus.ACCEPTED)
  async queue(
    @Req() request: BusinessMediaRequest,
    @Param("assetId") assetId: unknown
  ) {
    let parsed;
    try {
      parsed = parseBusinessMediaAssetId(assetId);
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: "INVALID_BUSINESS_MEDIA",
          message: (error as Error).message
        }
      });
    }
    return {
      data: await this.service.queue(request.tenantAdminContext, parsed)
    };
  }

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
