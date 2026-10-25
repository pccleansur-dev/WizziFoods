import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  parseReleaseRewardRequest,
  parseReserveRewardRequest,
  parseSaveDinerBirthdayRequest
} from "@platform/contracts";

import { mapDinerFailure } from "../diner-identity/diner-errors.js";
import { DinerIdentityService } from "../diner-identity/diner-identity.service.js";
import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { mapLoyaltyDinerFailure } from "./loyalty-errors.js";
import { LoyaltyService } from "./loyalty.service.js";

function invalid(): BadRequestException {
  return new BadRequestException({
    error: { code: "INVALID_LOYALTY_REQUEST", message: "Revisá los datos." }
  });
}

/**
 * Progress, birthday and rewards of a signed-in diner. The account comes from the
 * diner session, the restaurant from the host; the menu never calls these to load.
 */
@Controller("v1/public/diner/loyalty")
@UseGuards(TenantHostGuard)
export class LoyaltyDinerController {
  constructor(
    @Inject(DinerIdentityService) private readonly diners: DinerIdentityService,
    @Inject(LoyaltyService) private readonly loyalty: LoyaltyService
  ) {}

  private async accountOf(
    request: TenantHostRequest,
    authorization: string | undefined
  ): Promise<string> {
    const token = /^Bearer (\S+)$/u.exec(authorization ?? "")?.[1];
    try {
      return await this.diners.authenticate(
        request.tenantHostContext.tenant.id,
        token
      );
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  private scope(request: TenantHostRequest) {
    return {
      locationId: request.tenantHostContext.location.id,
      tenantId: request.tenantHostContext.tenant.id
    };
  }

  @Get()
  async view(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined
  ) {
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.loyalty.getDinerLoyalty(this.scope(request), accountId)
      };
    } catch (error) {
      return mapLoyaltyDinerFailure(error);
    }
  }

  @Put("birthday")
  async birthday(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parseSaveDinerBirthdayRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.loyalty.saveBirthday(
          this.scope(request),
          accountId,
          parsed
        )
      };
    } catch (error) {
      return mapLoyaltyDinerFailure(error);
    }
  }

  @Post("rewards/reserve")
  @HttpCode(HttpStatus.OK)
  async reserve(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parseReserveRewardRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.loyalty.reserveReward(
          this.scope(request),
          accountId,
          parsed
        )
      };
    } catch (error) {
      return mapLoyaltyDinerFailure(error);
    }
  }

  @Post("rewards/release")
  @HttpCode(HttpStatus.OK)
  async release(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parseReleaseRewardRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.loyalty.releaseReward(
          this.scope(request),
          accountId,
          parsed
        )
      };
    } catch (error) {
      return mapLoyaltyDinerFailure(error);
    }
  }
}
