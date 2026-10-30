import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { parseDinerWaiterCallRequest } from "@platform/contracts";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { WaiterCallService } from "./waiter-call.service.js";

type PublicRequest = Pick<TenantHostRequest, "tenantHostContext">;

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
    error: { code: "INVALID_WAITER_CALL", message: "Pedido inválido." }
  });
}

/** Translates database failures without echoing any database detail. */
function mapFailure(error: unknown): never {
  switch (databaseCode(error)) {
    case "PT101":
    case "PT102":
      throw new ConflictException({
        error: {
          code: "WAITER_CALL_TABLE_CHANGED",
          message:
            "Ahora no podemos avisar al mozo desde esta mesa. Escaneá nuevamente el QR o pedile ayuda al personal."
        }
      });
    case "PT120":
      throw invalid();
    case "PT121":
      throw new ConflictException({
        error: {
          code: "WAITER_CALL_NO_OPEN_TABLE",
          message:
            "Todavía no hay una cuenta abierta en esta mesa. Llamá al mozo para que te atienda."
        }
      });
    case "PT122":
      throw new HttpException(
        {
          error: {
            code: "WAITER_CALL_RATE_LIMITED",
            message:
              "Ya avisamos varias veces desde esta mesa. Esperá un momento: el mozo ya está al tanto."
          }
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    default:
      throw error;
  }
}

/**
 * Public call to the waiter from a scanned table QR. The token and the reason
 * travel in the body; the tenant, the location and the table are never accepted
 * from the client.
 */
@Controller("v1/public/waiter-calls")
@UseGuards(TenantHostGuard)
export class WaiterCallController {
  constructor(
    @Inject(WaiterCallService) private readonly service: WaiterCallService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@Req() request: PublicRequest, @Body() body: unknown) {
    const parsed = parseDinerWaiterCallRequest(body);
    if (!parsed) throw invalid();
    try {
      return {
        data: await this.service.create(request.tenantHostContext, parsed)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }
}
