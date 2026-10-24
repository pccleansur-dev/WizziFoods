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
  parseProductionAdvanceRequest,
  type StaffCapability
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { ProductionService } from "./production.service.js";

type ProductionRequest = Pick<StaffSessionRequest, "staffContext">;

const productionCapabilities: readonly StaffCapability[] = [
  "production.kitchen.manage",
  "production.bar.manage"
];

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function invalid(): BadRequestException {
  return new BadRequestException({
    error: {
      code: "INVALID_PRODUCTION_REQUEST",
      message: "Revisá los datos de la operación."
    }
  });
}

/** Translates database failures without echoing any database detail. */
function mapFailure(error: unknown): never {
  switch (databaseCode(error)) {
    case "PT100":
      throw new ConflictException({
        error: {
          code: "WAITER_COMMAND_REUSED",
          message:
            "Esa operación ya se usó con otros datos. Volvé a intentarlo."
        }
      });
    case "PT200":
      throw new ForbiddenException({
        error: {
          code: "STAFF_FORBIDDEN",
          message: "No tenés permiso para operar la producción."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "PRODUCTION_ITEM_NOT_FOUND",
          message: "No encontramos ese ítem en tu sector."
        }
      });
    case "PT212":
      throw invalid();
    case "PT220":
      throw new ConflictException({
        error: {
          code: "PRODUCTION_TRANSITION_INVALID",
          message: "El ítem no puede pasar a ese estado. Actualizá la pantalla."
        }
      });
    default:
      throw error;
  }
}

function needsProduction(
  request: ProductionRequest
): ProductionRequest["staffContext"] {
  const { capabilities } = request.staffContext;
  if (!productionCapabilities.some((entry) => capabilities.includes(entry))) {
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

@Controller("v1/staff/production")
@UseGuards(StaffSessionGuard)
export class ProductionController {
  constructor(
    @Inject(ProductionService) private readonly service: ProductionService
  ) {}

  @Get()
  async board(@Req() request: ProductionRequest) {
    const context = needsProduction(request);
    try {
      return { data: await this.service.getBoard(context) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("orders/:orderId/items/:lineId/status")
  @HttpCode(HttpStatus.OK)
  async advance(
    @Req() request: ProductionRequest,
    @Param("orderId") orderId: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown
  ) {
    const context = needsProduction(request);
    const parsed = parseProductionAdvanceRequest(body);
    const order = identifier(orderId);
    const line = identifier(lineId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.advanceItem(context, order, line, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
