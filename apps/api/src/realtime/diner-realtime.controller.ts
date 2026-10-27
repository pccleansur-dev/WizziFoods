import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type { FloorPlanRepository } from "@platform/database";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { RealtimeTokenService } from "./realtime-token.service.js";

export const DINER_QR_RESOLVER = Symbol("DINER_QR_RESOLVER");

const tokenPattern = /^[0-9a-f]{64}$/u;

/**
 * Lets the page a diner opened by scanning a table's QR hear "something changed" about
 * that table (it was grouped, taken out of service, its account was split…) instead of
 * asking over and over. The QR token travels in the body; the restaurant comes from the
 * host; the only channel in the token is the one of the table the QR stands for. The
 * channel carries no data: the page asks the API again, as it always did.
 */
@Controller("v1/public/realtime")
@UseGuards(TenantHostGuard)
export class DinerRealtimeController {
  constructor(
    @Inject(RealtimeTokenService) private readonly tokens: RealtimeTokenService,
    @Inject(DINER_QR_RESOLVER)
    private readonly tables: Pick<FloorPlanRepository, "resolveQr">
  ) {}

  @Post("token")
  @HttpCode(HttpStatus.OK)
  async token(
    @Req() request: Pick<TenantHostRequest, "tenantHostContext">,
    @Body() body: unknown
  ) {
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).join() !== "token" ||
      typeof (body as { token: unknown }).token !== "string" ||
      !tokenPattern.test((body as { token: string }).token)
    ) {
      throw new BadRequestException({
        error: { code: "INVALID_REALTIME_REQUEST", message: "Pedido inválido." }
      });
    }
    const scope = {
      locationId: request.tenantHostContext.location.id,
      tenantId: request.tenantHostContext.tenant.id
    };
    const found = await this.tables.resolveQr(
      scope,
      (body as { token: string }).token
    );
    if (!found) {
      throw new NotFoundException({
        error: { code: "TABLE_NOT_FOUND", message: "No encontramos la mesa." }
      });
    }
    return { data: await this.tokens.issueForTable(scope, found.tableId) };
  }
}
