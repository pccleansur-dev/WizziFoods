import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest
} from "../auth/admin-auth.guard.js";
import {
  parseIdempotencyKey,
  parseTenantProvisioningRequest
} from "./tenant-provisioning-input.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";

@Controller("v1/platform/tenants")
@UseGuards(AdminAuthGuard)
export class TenantProvisioningController {
  constructor(
    @Inject(TenantProvisioningService)
    private readonly service: TenantProvisioningService
  ) {}

  @Post()
  async create(
    @Req() request: Pick<AdminAuthenticatedRequest, "adminIdentity">,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    let parsedIdempotencyKey: string;
    let parsedBody;
    try {
      parsedIdempotencyKey = parseIdempotencyKey(idempotencyKey);
      parsedBody = parseTenantProvisioningRequest(body);
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: "INVALID_TENANT_PROVISIONING",
          message: (error as Error).message
        }
      });
    }

    const result = await this.service.create(
      request.adminIdentity,
      parsedIdempotencyKey,
      parsedBody
    );
    return { data: result };
  }
}
