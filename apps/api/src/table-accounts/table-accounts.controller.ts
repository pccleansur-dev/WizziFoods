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
  parseApplyDiscountRequest,
  parseKeepOpenRequest,
  parseRecordPaymentRequest,
  type StaffCapability
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { TableAccountsService } from "./table-accounts.service.js";

type AccountRequest = Pick<StaffSessionRequest, "staffContext">;

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
      code: "INVALID_ACCOUNT_REQUEST",
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
          message: "No tenés permiso para operar la cuenta."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: "No encontramos esa cuenta en tu zona."
        }
      });
    case "PT212":
      throw invalid();
    case "PT222":
      throw new ForbiddenException({
        error: {
          code: "MANAGER_REQUIRED",
          message: "Los descuentos los otorga el Encargado."
        }
      });
    case "PT230":
      throw conflict(
        "PAYMENT_EXCEEDS_PENDING",
        "El cobro supera el saldo pendiente. Actualizá la cuenta."
      );
    case "PT231":
      throw conflict(
        "NOTHING_TO_COLLECT",
        "La cuenta no tiene saldo pendiente para cobrar."
      );
    case "PT232":
      throw conflict(
        "DISCOUNT_TOO_LARGE",
        "El descuento supera el saldo pendiente."
      );
    default:
      throw error;
  }
}

function needs(
  request: AccountRequest,
  capability: StaffCapability
): AccountRequest["staffContext"] {
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

@Controller("v1/staff/accounts")
@UseGuards(StaffSessionGuard)
export class TableAccountsController {
  constructor(
    @Inject(TableAccountsService) private readonly service: TableAccountsService
  ) {}

  /** Open accounts of the waiter's tables, with the ledger movements. */
  @Get()
  async accounts(@Req() request: AccountRequest) {
    const context = needs(request, "tables.serve");
    try {
      return { data: await this.service.getAccounts(context) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post(":sessionId/payments")
  @HttpCode(HttpStatus.OK)
  async pay(
    @Req() request: AccountRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "payments.collect");
    const parsed = parseRecordPaymentRequest(body);
    const session = identifier(sessionId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.recordPayment(context, session, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Only a manager grants a discount, always with a reason. */
  @Post(":sessionId/discounts")
  @HttpCode(HttpStatus.OK)
  async discount(
    @Req() request: AccountRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "operations.approve");
    const parsed = parseApplyDiscountRequest(body);
    const session = identifier(sessionId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.applyDiscount(context, session, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post(":sessionId/keep-open")
  @HttpCode(HttpStatus.OK)
  async keepOpen(
    @Req() request: AccountRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "payments.collect");
    const parsed = parseKeepOpenRequest(body);
    const session = identifier(sessionId);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.keepOpen(context, session, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
