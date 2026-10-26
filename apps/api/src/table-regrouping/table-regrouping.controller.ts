import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
  parseJoinTablesCommand,
  parseSeparateTablesCommand
} from "@platform/contracts";

import {
  StaffSessionGuard,
  type StaffSessionRequest
} from "../staff-auth/staff-session.guard.js";
import { TableRegroupingService } from "./table-regrouping.service.js";

type RegroupingRequest = Pick<StaffSessionRequest, "staffContext">;

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
      code: "INVALID_TABLE_REGROUPING_REQUEST",
      message: "Revisá las mesas elegidas."
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
          message: "No tenés permiso para operar estas mesas."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "TABLE_GROUP_NOT_FOUND",
          message: "No encontramos esas mesas en tu zona."
        }
      });
    case "PT277":
      throw conflict(
        "TABLES_CANNOT_BE_JOINED",
        "Esas mesas no se pueden unir ahora: tienen que estar en la misma planta, sin limpieza pendiente y en servicio."
      );
    case "PT278":
      throw conflict(
        "DIFFERENT_OPEN_ACCOUNTS",
        "Esas mesas tienen cuentas abiertas distintas. Cerrá una antes de unirlas."
      );
    case "PT279":
      throw conflict(
        "ANCHOR_TABLE_REQUIRED",
        "Elegí qué mesa se queda con la cuenta abierta."
      );
    default:
      throw error;
  }
}

function needsToServe(request: RegroupingRequest) {
  if (!request.staffContext.capabilities.includes("tables.serve")) {
    throw new ForbiddenException({
      error: {
        code: "STAFF_FORBIDDEN",
        message: "Tu rol no puede realizar esta operación."
      }
    });
  }
  return request.staffContext;
}

@Controller("v1/staff/table-groups")
@UseGuards(StaffSessionGuard)
export class TableRegroupingController {
  constructor(
    @Inject(TableRegroupingService)
    private readonly service: TableRegroupingService
  ) {}

  /** Joins tables: an open account follows the group and nothing is moved. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async join(@Req() request: RegroupingRequest, @Body() body: unknown) {
    const context = needsToServe(request);
    const parsed = parseJoinTablesCommand(body);
    if (!parsed) throw invalid();
    try {
      return { data: await this.service.joinTables(context, parsed) };
    } catch (error) {
      return mapFailure(error);
    }
  }

  /** Separates a group: the open account stays with the chosen anchor table. */
  @Post(":groupId/separate")
  @HttpCode(HttpStatus.OK)
  async separate(
    @Req() request: RegroupingRequest,
    @Param("groupId") groupId: string,
    @Body() body: unknown
  ) {
    const context = needsToServe(request);
    const parsed = parseSeparateTablesCommand(body);
    if (!parsed || !isWaiterUuid(groupId)) throw invalid();
    try {
      return {
        data: await this.service.separateTables(context, groupId, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
