import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  parseDinerPaymentTarget,
  parsePayOnlinePaymentRequest
} from "@platform/contracts";
import type { FastifyReply } from "fastify";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import {
  invalidPaymentRequest,
  mapPaymentFailure
} from "./mercado-pago.errors.js";
import { MercadoPagoService } from "./mercado-pago.service.js";

type PublicRequest = Pick<TenantHostRequest, "tenantHostContext">;

function scopeOf(request: PublicRequest) {
  return {
    locationId: request.tenantHostContext.location.id,
    tenantId: request.tenantHostContext.tenant.id
  };
}

/** The diner's checkout. The business comes from the host, the order from the table token. */
@Controller("v1/public/online-payments")
@UseGuards(TenantHostGuard)
export class OnlinePaymentsController {
  constructor(
    @Inject(MercadoPagoService) private readonly service: MercadoPagoService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async start(@Req() request: PublicRequest, @Body() body: unknown) {
    const target = parseDinerPaymentTarget(body);
    if (!target) throw invalidPaymentRequest();
    try {
      return {
        data: await this.service.startPayment(scopeOf(request), target)
      };
    } catch (error) {
      return mapPaymentFailure(error);
    }
  }

  @Post("pay")
  @HttpCode(HttpStatus.OK)
  async pay(@Req() request: PublicRequest, @Body() body: unknown) {
    const parsed = parsePayOnlinePaymentRequest(body);
    if (!parsed) throw invalidPaymentRequest();
    try {
      return { data: await this.service.pay(scopeOf(request), parsed) };
    } catch (error) {
      return mapPaymentFailure(error);
    }
  }

  @Post("status")
  @HttpCode(HttpStatus.OK)
  async status(@Req() request: PublicRequest, @Body() body: unknown) {
    const target = parseDinerPaymentTarget(body);
    if (!target) throw invalidPaymentRequest();
    try {
      return { data: await this.service.status(scopeOf(request), target) };
    } catch (error) {
      return mapPaymentFailure(error);
    }
  }
}

const codePattern = /^[0-9A-Za-z._-]{1,300}$/u;
const statePattern = /^[0-9A-Za-z_-]{43}$/u;

/** Where the browser returns after authorizing the connection with Mercado Pago. */
@Controller("v1/payments/mercado-pago")
export class MercadoPagoCallbackController {
  constructor(
    @Inject(MercadoPagoService) private readonly service: MercadoPagoService
  ) {}

  @Get("callback")
  async callback(
    @Query("code") code: unknown,
    @Query("state") state: unknown,
    @Res() reply: FastifyReply
  ) {
    const destination =
      typeof code === "string" &&
      typeof state === "string" &&
      codePattern.test(code) &&
      statePattern.test(state)
        ? await this.service.completeConnection(code, state)
        : await this.service.completeConnection("invalid", "invalid");
    return reply
      .status(302)
      .header("cache-control", "no-store")
      .header("location", destination)
      .send();
  }
}
