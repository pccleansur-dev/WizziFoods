import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
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
  parseGrantSupportAccessRequest,
  parseRevokeSupportAccessRequest
} from "./support-access-input.js";
import { SupportAccessService } from "./support-access.service.js";

type SupportAccessRequest = Pick<
  TenantAdminScopedRequest,
  "tenantAdminContext"
> & { id: string };

@Controller("v1/tenant/support-access")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class SupportAccessController {
  constructor(
    @Inject(SupportAccessService)
    private readonly service: SupportAccessService
  ) {}

  @Get()
  async list(@Req() request: SupportAccessRequest) {
    return { data: await this.service.list(request.tenantAdminContext) };
  }

  @Post()
  async grant(@Req() request: SupportAccessRequest, @Body() body: unknown) {
    let parsed;
    try {
      parsed = parseGrantSupportAccessRequest(body);
    } catch (error) {
      throw this.invalidInput((error as Error).message);
    }
    return {
      data: await this.service.grant(
        request.tenantAdminContext,
        parsed,
        request.id
      )
    };
  }

  @Delete(":grantId")
  async revoke(
    @Req() request: SupportAccessRequest,
    @Param("grantId", new ParseUUIDPipe({ version: "4" })) grantId: string,
    @Body() body: unknown
  ) {
    let parsed;
    try {
      parsed = parseRevokeSupportAccessRequest(body);
    } catch (error) {
      throw this.invalidInput((error as Error).message);
    }
    return {
      data: await this.service.revoke(
        request.tenantAdminContext,
        grantId,
        parsed,
        request.id
      )
    };
  }

  private invalidInput(message: string): BadRequestException {
    return new BadRequestException({
      error: { code: "INVALID_SUPPORT_ACCESS", message }
    });
  }
}
