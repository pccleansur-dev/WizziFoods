import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  parseDinerConsentRequest,
  parseDinerSessionLinkRequest,
  parseSaveDinerProfileRequest
} from "@platform/contracts";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { mapDinerFailure } from "./diner-errors.js";
import { DinerIdentityService } from "./diner-identity.service.js";

function invalid(): BadRequestException {
  return new BadRequestException({
    error: { code: "INVALID_DINER_REQUEST", message: "Revisá los datos." }
  });
}

/**
 * What a signed-in diner can do. The account comes from the session token, the
 * restaurant from the host; neither is ever read from the body. A diner without a
 * session simply never reaches these routes, and the menu never calls them to load.
 */
@Controller("v1/public/diner")
@UseGuards(TenantHostGuard)
export class DinerAccountController {
  constructor(
    @Inject(DinerIdentityService) private readonly diners: DinerIdentityService
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

  @Get("me")
  async me(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined
  ) {
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.diners.getProfile(
          request.tenantHostContext.tenant.id,
          accountId
        )
      };
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  @Put("profile")
  async saveProfile(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parseSaveDinerProfileRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.diners.saveProfile(
          request.tenantHostContext.tenant.id,
          accountId,
          parsed
        )
      };
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  @Post("consents")
  @HttpCode(HttpStatus.OK)
  async consent(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parseDinerConsentRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.diners.recordConsent(
          request.tenantHostContext.tenant.id,
          accountId,
          parsed
        )
      };
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  @Post("session-links")
  @HttpCode(HttpStatus.OK)
  async link(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const parsed = parseDinerSessionLinkRequest(body);
    if (!parsed) throw invalid();
    const accountId = await this.accountOf(request, authorization);
    try {
      return {
        data: await this.diners.linkToSession(
          {
            locationId: request.tenantHostContext.location.id,
            tenantId: request.tenantHostContext.tenant.id
          },
          accountId,
          parsed.token
        )
      };
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  @Get("export")
  async export(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined
  ) {
    const accountId = await this.accountOf(request, authorization);
    try {
      return { data: await this.diners.export(accountId) };
    } catch (error) {
      return mapDinerFailure(error);
    }
  }

  @Delete("account")
  @HttpCode(HttpStatus.NO_CONTENT)
  async anonymize(
    @Req() request: TenantHostRequest,
    @Headers("authorization") authorization: string | undefined
  ) {
    const accountId = await this.accountOf(request, authorization);
    try {
      await this.diners.anonymize(accountId);
    } catch (error) {
      mapDinerFailure(error);
    }
  }
}
