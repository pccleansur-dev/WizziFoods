import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import {
  isTeamUuid,
  parseTeamMemberActivation,
  parseTeamMemberCreate,
  parseTeamMemberUpdate,
  parseTeamPinReset,
  type TeamIssue,
  type TeamParseResult
} from "@platform/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { TeamService } from "./team.service.js";

type TeamRequest = Pick<TenantAdminScopedRequest, "tenantAdminContext">;

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** Translates database failures without echoing any database detail. */
function mapFailure(error: unknown): never {
  switch (databaseCode(error)) {
    case "23505":
      throw new ConflictException({
        error: {
          code: "TEAM_USERNAME_TAKEN",
          message: "Ya existe un empleado con ese usuario."
        }
      });
    case "PT001":
      throw new ConflictException({
        error: {
          code: "TEAM_LAST_MANAGER",
          message:
            "Debe quedar al menos un Encargado activo. Activá o creá otro antes de continuar."
        }
      });
    case "P0002":
      throw new NotFoundException({
        error: {
          code: "TEAM_MEMBER_NOT_FOUND",
          message: "No encontramos al empleado."
        }
      });
    case "22023":
    case "23514":
    case "23503":
      throw new UnprocessableEntityException({
        error: {
          code: "TEAM_INVALID_STATE",
          message:
            "Los datos del empleado o sus sectores ya no son válidos. Recargá e intentá nuevamente."
        }
      });
    default:
      throw error;
  }
}

function invalid(issues: TeamIssue[]): never {
  throw new BadRequestException({
    error: {
      code: "INVALID_TEAM_REQUEST",
      issues,
      message: "Revisá los datos marcados."
    }
  });
}

function valueOf<T>(result: TeamParseResult<T>): T {
  return result.ok ? result.value : invalid(result.issues);
}

function memberId(raw: unknown): string {
  if (!isTeamUuid(raw)) {
    throw new BadRequestException({
      error: { code: "INVALID_TEAM_MEMBER", message: "Empleado inválido." }
    });
  }
  return raw;
}

@Controller("v1/tenant/team")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class TeamAdminController {
  constructor(@Inject(TeamService) private readonly service: TeamService) {}

  @Get()
  async list(@Req() request: TeamRequest) {
    return { data: await this.service.list(request.tenantAdminContext) };
  }

  @Post()
  async create(@Req() request: TeamRequest, @Body() body: unknown) {
    const input = valueOf(parseTeamMemberCreate(body));
    try {
      return {
        data: await this.service.create(request.tenantAdminContext, input)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Patch(":memberId")
  async update(
    @Req() request: TeamRequest,
    @Param("memberId") rawId: unknown,
    @Body() body: unknown
  ) {
    const id = memberId(rawId);
    const update = valueOf(parseTeamMemberUpdate(body));
    try {
      return {
        data: await this.service.update(request.tenantAdminContext, id, update)
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Put(":memberId/active")
  async setActive(
    @Req() request: TeamRequest,
    @Param("memberId") rawId: unknown,
    @Body() body: unknown
  ) {
    const id = memberId(rawId);
    const { active } = valueOf(parseTeamMemberActivation(body));
    try {
      return {
        data: await this.service.setActive(
          request.tenantAdminContext,
          id,
          active
        )
      };
    } catch (error) {
      return mapFailure(error);
    }
  }

  @Put(":memberId/pin")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPin(
    @Req() request: TeamRequest,
    @Param("memberId") rawId: unknown,
    @Body() body: unknown
  ) {
    const id = memberId(rawId);
    const { pin } = valueOf(parseTeamPinReset(body));
    try {
      await this.service.resetPin(request.tenantAdminContext, id, pin);
    } catch (error) {
      mapFailure(error);
    }
  }
}
