import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { isWaiterUuid, parseOnlineRefundRequest } from "@platform/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import {
  invalidPaymentRequest,
  mapPaymentFailure
} from "./mercado-pago.errors.js";
import { MercadoPagoService } from "./mercado-pago.service.js";

type AdminRequest = Pick<TenantAdminScopedRequest, "tenantAdminContext">;
type StaffRequest = Pick<StaffSessionRequest, "staffContext">;

/** The business owner connects (or disconnects) their own Mercado Pago account. */
@Controller("v1/tenant/mercado-pago")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class MercadoPagoAdminController {
  constructor(
    @Inject(MercadoPagoService) private readonly service: MercadoPagoService
  ) {}

  @Post("connect")
  @HttpCode(HttpStatus.OK)
  async connect(@Req() request: AdminRequest) {
    const context = request.tenantAdminContext;
    try {
      return {
        data: await this.service.startConnection(
          context.scope,
          context.identity.userId
        )
      };
    } catch (error) {
      return mapPaymentFailure(error);
    }
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async disconnect(@Req() request: AdminRequest) {
    const context = request.tenantAdminContext;
    try {
      await this.service.disconnect(context.scope, context.identity.userId);
      return { data: { disconnected: true } };
    } catch (error) {
      return mapPaymentFailure(error);
    }
  }
}

/** A manager returns money of an online payment; Mercado Pago confirms it. */
@Controller("v1/staff/accounts")
@UseGuards(StaffSessionGuard)
export class OnlineRefundsController {
  constructor(
    @Inject(MercadoPagoService) private readonly service: MercadoPagoService
  ) {}

  @Post(":sessionId/online-refunds")
  @HttpCode(HttpStatus.OK)
  async refund(
    @Req() request: StaffRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = request.staffContext;
    if (!context.capabilities.includes("operations.approve")) {
      throw new ForbiddenException({
        error: {
          code: "STAFF_FORBIDDEN",
          message: "Tu rol no puede realizar esta operación."
        }
      });
    }
    const parsed = parseOnlineRefundRequest(body);
    if (!parsed || !isWaiterUuid(sessionId)) throw invalidPaymentRequest();
    try {
      return {
        data: await this.service.refund(
          context.scope,
          context.staffId,
          sessionId,
          parsed
        )
      };
    } catch (error) {
      return mapPaymentFailure(error);
    }
  }
}
