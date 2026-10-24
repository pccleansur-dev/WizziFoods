import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { TableEntryService } from "./table-entry.service.js";

const tokenPattern = /^[0-9a-f]{64}$/u;

/**
 * Public entry for a scanned table QR. The token travels in the body so it never
 * reaches access logs, and the tenant and location come only from the host.
 */
@Controller("v1/public/table-entry")
@UseGuards(TenantHostGuard)
export class TableEntryController {
  constructor(
    @Inject(TableEntryService) private readonly service: TableEntryService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async enter(
    @Req() request: Pick<TenantHostRequest, "tenantHostContext">,
    @Body() body: unknown
  ) {
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).join() !== "token"
    ) {
      throw new BadRequestException({
        error: { code: "INVALID_TABLE_ENTRY", message: "Pedido inválido." }
      });
    }
    const { token } = body as { token: unknown };
    if (typeof token !== "string" || !tokenPattern.test(token)) {
      return { data: { status: "invalid" } };
    }
    return {
      data: await this.service.resolve(request.tenantHostContext, token)
    };
  }
}
