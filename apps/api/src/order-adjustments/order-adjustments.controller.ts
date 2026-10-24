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
  parseCancelItemRequest,
  parseDeliverItemRequest,
  parseProductionExceptionRequest,
  parseReplacementDecisionRequest,
  parseReplacementProposalRequest,
  type StaffCapability
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { OrderAdjustmentsService } from "./order-adjustments.service.js";

type AdjustmentRequest = Pick<StaffSessionRequest, "staffContext">;

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

function invalid(): BadRequestException {
  return new BadRequestException({
    error: {
      code: "INVALID_ORDER_ADJUSTMENT_REQUEST",
      message: "Revisá los datos de la operación."
    }
  });
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
          message: "No tenés permiso para esta operación."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "ORDER_TARGET_NOT_FOUND",
          message: "No encontramos ese pedido o ítem en tu zona."
        }
      });
    case "PT206":
      throw conflict(
        "STOCK_INSUFFICIENT",
        "No alcanza el stock para el reemplazo."
      );
    case "PT211":
      throw conflict(
        "MENU_PRICE_CHANGED",
        "El precio del reemplazo cambió. Proponelo de nuevo al comensal."
      );
    case "PT102":
    case "PT104":
    case "PT105":
      throw conflict(
        "ORDER_ITEMS_CHANGED",
        "Ese producto ya no está disponible en la carta."
      );
    case "PT212":
      throw invalid();
    case "PT220":
      throw conflict(
        "PRODUCTION_TRANSITION_INVALID",
        "El ítem no puede pasar a ese estado. Actualizá la pantalla."
      );
    case "PT221":
      throw conflict(
        "ITEM_NOT_READY",
        "Solo se entrega un ítem que ya está listo."
      );
    case "PT222":
      throw new ForbiddenException({
        error: {
          code: "MANAGER_REQUIRED",
          message: "Cancelar un ítem lo decide el Encargado."
        }
      });
    case "PT224":
      throw conflict(
        "ADJUSTMENT_ALREADY_DECIDED",
        "Ese reemplazo ya fue decidido o ya hay uno pendiente."
      );
    default:
      throw error;
  }
}

function needsAny(
  request: AdjustmentRequest,
  capabilities: readonly StaffCapability[]
): AdjustmentRequest["staffContext"] {
  if (
    !capabilities.some((entry) =>
      request.staffContext.capabilities.includes(entry)
    )
  ) {
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
export class OrderAdjustmentsController {
  constructor(
    @Inject(OrderAdjustmentsService)
    private readonly service: OrderAdjustmentsService
  ) {}

  /** Orders of the waiter's tables with the state of every item. */
  @Get("orders/in-progress")
  async orders(@Req() request: AdjustmentRequest) {
    const context = needsAny(request, ["tables.serve"]);
    try {
      return { data: await this.service.getOrders(context) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("orders/:orderId/items/:lineId/delivery")
  @HttpCode(HttpStatus.OK)
  async deliver(
    @Req() request: AdjustmentRequest,
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown
  ) {
    const context = needsAny(request, ["tables.serve"]);
    const parsed = parseDeliverItemRequest(body);
    const order = identifier(orderId);
    const line = identifier(lineId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.deliverItem(context, order, line, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Kitchen and Bar report that they cannot make an item. */
  @Post("production/orders/:orderId/items/:lineId/exception")
  @HttpCode(HttpStatus.OK)
  async reportException(
    @Req() request: AdjustmentRequest,
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown
  ) {
    const context = needsAny(request, [
      "production.kitchen.manage",
      "production.bar.manage"
    ]);
    const parsed = parseProductionExceptionRequest(body);
    const order = identifier(orderId);
    const line = identifier(lineId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.reportException(context, order, line, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("orders/:orderId/items/:lineId/replacement")
  @HttpCode(HttpStatus.OK)
  async propose(
    @Req() request: AdjustmentRequest,
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown
  ) {
    const context = needsAny(request, ["orders.manage"]);
    const parsed = parseReplacementProposalRequest(body);
    const order = identifier(orderId);
    const line = identifier(lineId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.proposeReplacement(
          context,
          order,
          line,
          parsed
        )
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("order-adjustments/:adjustmentId/decision")
  @HttpCode(HttpStatus.OK)
  async decide(
    @Req() request: AdjustmentRequest,
    @Param("adjustmentId") adjustmentId: string,
    @Body() body: unknown
  ) {
    const context = needsAny(request, ["orders.manage"]);
    const parsed = parseReplacementDecisionRequest(body);
    const id = identifier(adjustmentId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.decideReplacement(context, id, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Only a manager cancels an item, always with a reason. */
  @Post("orders/:orderId/items/:lineId/cancellation")
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Req() request: AdjustmentRequest,
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown
  ) {
    const context = needsAny(request, ["operations.approve"]);
    const parsed = parseCancelItemRequest(body);
    const order = identifier(orderId);
    const line = identifier(lineId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.cancelItem(context, order, line, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
