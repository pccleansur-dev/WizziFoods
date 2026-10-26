import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import {
  FloorPlanInputError,
  parseFloorPlanRequest,
  parseFloorTableId,
  parseQrVerifyRequest
} from "./floor-plan-input.js";
import { FloorPlanService } from "./floor-plan.service.js";

type FloorPlanRequest = Pick<TenantAdminScopedRequest, "tenantAdminContext">;

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/** Translates database failures without echoing any database detail. */
function mapSaveFailure(error: unknown): never {
  const code = databaseCode(error);
  if (code === "40001") {
    throw new ConflictException({
      error: {
        code: "FLOOR_PLAN_VERSION_CONFLICT",
        message:
          "El plano cambió desde la última lectura. Recargá para ver los cambios y volvé a intentar."
      }
    });
  }
  if (code === "PT280") {
    throw new ConflictException({
      error: {
        code: "FLOOR_PLAN_GROUP_IN_USE",
        message:
          "Una agrupación tiene una cuenta abierta. Unila o separala desde el salón en vez de editar el plano."
      }
    });
  }
  if (
    code === "23505" &&
    /command id already used/u.test(databaseMessage(error))
  ) {
    throw new ConflictException({
      error: {
        code: "FLOOR_PLAN_COMMAND_REUSED",
        message: "Ese guardado ya se usó con otros datos. Intentá nuevamente."
      }
    });
  }
  if (code === "23P01") {
    throw new UnprocessableEntityException({
      error: {
        code: "FLOOR_PLAN_DUPLICATE_LABEL",
        message: "Dos mesas o dos plantas tienen el mismo nombre."
      }
    });
  }
  if (code === "23514") {
    throw new UnprocessableEntityException({
      error: {
        code: "FLOOR_PLAN_INVALID_GEOMETRY",
        message: "Alguna mesa tiene medidas o posición fuera de lo permitido."
      }
    });
  }
  if (code === "23505" || code === "23503" || code === "22023") {
    throw new UnprocessableEntityException({
      error: {
        code: "FLOOR_PLAN_INVALID_STATE",
        message:
          "El plano contiene referencias que ya no son válidas. Recargá e intentá nuevamente."
      }
    });
  }
  throw error;
}

@Controller("v1/tenant/floor-plan")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class FloorPlanAdminController {
  constructor(
    @Inject(FloorPlanService) private readonly service: FloorPlanService
  ) {}

  @Get()
  async get(@Req() request: FloorPlanRequest) {
    return { data: await this.service.getPlan(request.tenantAdminContext) };
  }

  @Put()
  async save(@Req() request: FloorPlanRequest, @Body() body: unknown) {
    let command;
    try {
      command = parseFloorPlanRequest(body);
    } catch (error) {
      if (error instanceof FloorPlanInputError) {
        throw new BadRequestException({
          error: {
            code: "INVALID_FLOOR_PLAN",
            issues: error.issues,
            message: "Revisá los datos marcados del plano."
          }
        });
      }
      throw error;
    }
    try {
      return {
        data: await this.service.savePlan(request.tenantAdminContext, command)
      };
    } catch (error) {
      return mapSaveFailure(error);
    }
  }

  @Get("qr")
  async listQr(@Req() request: FloorPlanRequest) {
    return {
      data: await this.service.listQrCodes(request.tenantAdminContext)
    };
  }

  @Post("qr/verify")
  @HttpCode(HttpStatus.OK)
  async verifyQr(@Req() request: FloorPlanRequest, @Body() body: unknown) {
    let token;
    try {
      token = parseQrVerifyRequest(body).token;
    } catch (error) {
      throw new BadRequestException({
        error: { code: "INVALID_FLOOR_QR", message: (error as Error).message }
      });
    }
    return {
      data: await this.service.verifyQr(request.tenantAdminContext, token)
    };
  }

  @Post("tables/:tableId/qr/rotate")
  @HttpCode(HttpStatus.NO_CONTENT)
  async rotateQr(
    @Req() request: FloorPlanRequest,
    @Param("tableId") rawTableId: unknown
  ) {
    let tableId;
    try {
      tableId = parseFloorTableId(rawTableId);
    } catch (error) {
      throw new BadRequestException({
        error: {
          code: "INVALID_FLOOR_TABLE",
          message: (error as Error).message
        }
      });
    }
    await this.service.rotateQr(request.tenantAdminContext, tableId);
  }
}
