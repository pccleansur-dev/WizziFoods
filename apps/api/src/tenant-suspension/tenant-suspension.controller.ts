import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest
} from "../auth/admin-auth.guard.js";
import { parseTenantSuspensionRequest } from "./tenant-suspension-input.js";
import { TenantSuspensionService } from "./tenant-suspension.service.js";

type TenantSuspensionHttpRequest = Pick<
  AdminAuthenticatedRequest,
  "adminIdentity"
> & { id: string };

@Controller("v1/platform/tenants")
@UseGuards(AdminAuthGuard)
export class TenantSuspensionController {
  constructor(
    @Inject(TenantSuspensionService)
    private readonly service: TenantSuspensionService
  ) {}

  @Post(":tenantId/suspension")
  async request(
    @Req() request: TenantSuspensionHttpRequest,
    @Param("tenantId", new ParseUUIDPipe({ version: "4" })) tenantId: string,
    @Body() body: unknown
  ) {
    let parsed;
    try {
      parsed = parseTenantSuspensionRequest(body);
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: "INVALID_TENANT_SUSPENSION",
          message: (error as Error).message
        }
      });
    }

    return {
      data: await this.service.request(
        request.adminIdentity,
        tenantId,
        parsed,
        request.id
      )
    };
  }
}
