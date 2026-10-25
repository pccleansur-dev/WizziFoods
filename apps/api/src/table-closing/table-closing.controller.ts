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
  parseTableClosingCommand,
  type StaffCapability
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { TableClosingService } from "./table-closing.service.js";

type ClosingRequest = Pick<StaffSessionRequest, "staffContext">;

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
      code: "INVALID_TABLE_CLOSING_REQUEST",
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
          message: "No tenés permiso para operar esta mesa."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: "No encontramos eso en tu zona."
        }
      });
    case "PT222":
      throw new ForbiddenException({
        error: {
          code: "MANAGER_REQUIRED",
          message: "Esta operación la hace el Encargado."
        }
      });
    case "PT270":
      throw conflict(
        "BALANCE_NOT_SETTLED",
        "La cuenta todavía tiene saldo. Cobrala o ajustala antes de cerrar."
      );
    case "PT271":
      throw conflict(
        "ONLINE_REFUND_PENDING",
        "Hay un pago online por devolver. Devolvelo antes de cerrar la cuenta."
      );
    case "PT272":
    case "PT273":
      throw conflict(
        "ACCOUNT_ALREADY_CLOSED",
        "Esa cuenta ya está cerrada. Actualizá el salón."
      );
    case "PT274":
      throw conflict(
        "TABLE_NOT_PENDING_CLEANING",
        "Esa mesa no está pendiente de limpieza."
      );
    case "PT275":
      throw conflict(
        "TABLE_STATE_INVALID",
        "La mesa no puede pasar a ese estado."
      );
    case "PT276":
      throw conflict(
        "RECEIPT_NOT_READY",
        "La cuenta todavía no tiene comprobante."
      );
    default:
      throw error;
  }
}

function needs(
  request: ClosingRequest,
  capability: StaffCapability
): ClosingRequest["staffContext"] {
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
export class TableClosingController {
  constructor(
    @Inject(TableClosingService) private readonly service: TableClosingService
  ) {}

  /** Recently closed accounts in the waiter's reach, with their receipt. */
  @Get("closed-accounts")
  async closedAccounts(@Req() request: ClosingRequest) {
    const context = needs(request, "tables.serve");
    try {
      return { data: await this.service.getClosedAccounts(context) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Closes a settled account: the table waits for cleaning, it is not freed. */
  @Post("accounts/:sessionId/close")
  @HttpCode(HttpStatus.OK)
  async close(
    @Req() request: ClosingRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "tables.serve");
    const parsed = parseTableClosingCommand(body);
    const session = identifier(sessionId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.closeAccount(context, session, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Get("accounts/:sessionId/receipt")
  async receipt(
    @Req() request: ClosingRequest,
    @Param("sessionId") sessionId: string
  ) {
    const context = needs(request, "tables.serve");
    const session = identifier(sessionId);
    try {
      return { data: await this.service.getReceipt(context, session) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** "Avisar a caja": an internal request with the table and the receipt. */
  @Post("accounts/:sessionId/cashier-requests")
  @HttpCode(HttpStatus.OK)
  async requestCashier(
    @Req() request: ClosingRequest,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "tables.serve");
    const parsed = parseTableClosingCommand(body);
    const session = identifier(sessionId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.requestCashier(context, session, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Post("cashier-requests/:requestId/resolve")
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Req() request: ClosingRequest,
    @Param("requestId") requestId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "operations.approve");
    const parsed = parseTableClosingCommand(body);
    const target = identifier(requestId);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.resolveCashierRequest(context, target, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Marks a table clean and available again. */
  @Post("tables/:tableId/clean")
  @HttpCode(HttpStatus.OK)
  async clean(
    @Req() request: ClosingRequest,
    @Param("tableId") tableId: string,
    @Body() body: unknown
  ) {
    const context = needs(request, "tables.serve");
    const parsed = parseTableClosingCommand(body);
    const table = identifier(tableId);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.cleanTable(context, table, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
