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
  parseCashMovementRequest,
  parseCloseShiftRequest,
  parseOpenShiftRequest,
  parseRefundRequest,
  type StaffCapability
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { CashRegisterService } from "./cash-register.service.js";

type RegisterRequest = Pick<StaffSessionRequest, "staffContext">;

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
      code: "INVALID_CASH_REGISTER_REQUEST",
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
          message: "No tenés permiso para operar la caja."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: "No encontramos esa cuenta o ese cobro."
        }
      });
    case "PT212":
      throw invalid();
    case "PT222":
      throw new ForbiddenException({
        error: {
          code: "MANAGER_REQUIRED",
          message: "Esta decisión la toma el Encargado."
        }
      });
    case "PT240":
      throw conflict(
        "CASH_REGISTER_CLOSED",
        "La caja está cerrada. El Encargado tiene que abrirla."
      );
    case "PT241":
      throw conflict("CASH_REGISTER_ALREADY_OPEN", "La caja ya está abierta.");
    case "PT242":
      throw conflict(
        "REFUND_EXCEEDS_LIMIT",
        "La devolución supera el saldo a favor o lo cobrado en ese pago."
      );
    default:
      throw error;
  }
}

function needs(
  request: RegisterRequest,
  capability: StaffCapability
): RegisterRequest["staffContext"] {
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
export class CashRegisterController {
  constructor(
    @Inject(CashRegisterService) private readonly service: CashRegisterService
  ) {}

  /** Whether the register is open; a manager also sees movements and closures. */
  @Get("cash-register")
  async register(@Req() request: RegisterRequest) {
    const context = needs(request, "payments.collect");
    try {
      return { data: await this.service.getRegister(context) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("cash-register/open")
  @HttpCode(HttpStatus.OK)
  async open(@Req() request: RegisterRequest, @Body() body: unknown) {
    const context = needs(request, "operations.approve");
    const parsed = parseOpenShiftRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.openShift(context, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("cash-register/movements")
  @HttpCode(HttpStatus.OK)
  async movement(@Req() request: RegisterRequest, @Body() body: unknown) {
    const context = needs(request, "operations.approve");
    const parsed = parseCashMovementRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.recordMovement(context, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Blind count: the body carries the counted cash, never the expected one. */
  @Post("cash-register/close")
  @HttpCode(HttpStatus.OK)
  async close(@Req() request: RegisterRequest, @Body() body: unknown) {
    const context = needs(request, "operations.approve");
    const parsed = parseCloseShiftRequest(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.closeShift(context, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Only a manager refunds, always against a payment of the account. */
  @Post("accounts/:sessionId/refunds")
  @HttpCode(HttpStatus.OK)
  async refund(
    @Req() request: RegisterRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "operations.approve");
    const parsed = parseRefundRequest(body);
    const session = identifier(sessionId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.recordRefund(context, session, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
