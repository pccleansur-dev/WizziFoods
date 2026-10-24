import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  isWaiterUuid,
  parseManualOrderRequest,
  parseWaiterCallClaimRequest,
  parseWaiterIntentDecisionRequest,
  type StaffCapability
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { WaiterService } from "./waiter.service.js";

type WaiterRequest = Pick<StaffSessionRequest, "staffContext">;

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ error: { code, message } });
}

/** Translates database failures without echoing any database detail. */
function mapFailure(error: unknown): never {
  switch (databaseCode(error)) {
    case "PT100":
      throw conflict(
        "WAITER_COMMAND_REUSED",
        "Esa operación ya se usó con otros datos. Volvé a intentarlo."
      );
    case "PT200":
      throw new ForbiddenException({
        error: {
          code: "STAFF_FORBIDDEN",
          message: "No tenés permiso para operar el salón."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "WAITER_TARGET_NOT_FOUND",
          message: "No encontramos esa mesa, pedido o llamado en tu zona."
        }
      });
    case "PT203":
      throw conflict("CALL_ALREADY_CLAIMED", "Otro mozo ya tomó este llamado.");
    case "PT204":
      throw conflict("CALL_CLOSED", "Este llamado ya está cerrado.");
    case "PT205":
      throw conflict(
        "INTENT_ALREADY_DECIDED",
        "Este pedido ya fue confirmado o rechazado."
      );
    case "PT206":
      throw conflict(
        "STOCK_INSUFFICIENT",
        "No alcanza el stock para confirmar este pedido."
      );
    case "PT207":
      throw conflict(
        "INTENT_NOT_CONFIRMABLE",
        "Este pedido espera un pago online y no se confirma desde el salón."
      );
    case "PT210":
      throw conflict(
        "TABLE_NOT_ENABLED",
        "La mesa no está habilitada para recibir pedidos."
      );
    case "PT211":
      throw conflict(
        "MENU_PRICE_CHANGED",
        "Los precios de la carta cambiaron. Pedí al comensal que revise el pedido."
      );
    case "PT102":
    case "PT104":
    case "PT105":
      throw conflict(
        "ORDER_ITEMS_CHANGED",
        "La disponibilidad de la carta cambió. Revisá el pedido."
      );
    case "PT212":
      throw invalid();
    default:
      throw error;
  }
}

function invalid(): BadRequestException {
  return new BadRequestException({
    error: {
      code: "INVALID_WAITER_REQUEST",
      message: "Revisá los datos de la operación."
    }
  });
}

function needs(
  request: WaiterRequest,
  capability: StaffCapability
): WaiterRequest["staffContext"] {
  if (!request.staffContext.capabilities.includes(capability)) {
    throw new ForbiddenException({
      error: {
        code: "STAFF_FORBIDDEN",
        message: "Tu rol no puede realizar esta operación."
      }
    });
  }
  return request.staffContext;
}

function identifier(value: string): string {
  if (!isWaiterUuid(value)) throw invalid();
  return value;
}

@Controller("v1/staff")
@UseGuards(StaffSessionGuard)
export class WaiterController {
  constructor(@Inject(WaiterService) private readonly service: WaiterService) {}

  @Get("salon")
  async salon(@Req() request: WaiterRequest) {
    const context = needs(request, "tables.serve");
    try {
      return { data: await this.service.getSalon(context) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Get("menu")
  async menu(@Req() request: WaiterRequest) {
    const context = needs(request, "orders.manage");
    return { data: await this.service.getMenu(context) };
  }

  @Post("calls/:callId/claim")
  @HttpCode(HttpStatus.OK)
  async claim(
    @Req() request: WaiterRequest,
    @Param("callId") callId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "calls.manage");
    const parsed = parseWaiterCallClaimRequest(body);
    const id = identifier(callId);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.claimCall(context, id, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("order-intents/:intentId/decisions")
  @HttpCode(HttpStatus.OK)
  async decide(
    @Req() request: WaiterRequest,
    @Param("intentId") intentId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "orders.validate");
    const parsed = parseWaiterIntentDecisionRequest(body);
    const id = identifier(intentId);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.decideIntent(context, id, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Req() request: WaiterRequest, @Body() body: unknown) {
    const context = needs(request, "orders.manage");
    const parsed = parseManualOrderRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.createManualOrder(context, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
