import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import { parsePublicationRequest } from "@platform/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import { ReadinessService } from "./readiness.service.js";

type ReadinessRequest = Pick<TenantAdminScopedRequest, "tenantAdminContext">;

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** Los comandos de T15 no reciben datos: el alcance sale de la sesión y el dominio. */
function emptyBody(body: unknown): void {
  if (!parsePublicationRequest(body).ok) {
    throw new BadRequestException({
      error: {
        code: "INVALID_READINESS_REQUEST",
        message: "Este comando no recibe datos."
      }
    });
  }
}

@Controller("v1/tenant")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class ReadinessAdminController {
  constructor(
    @Inject(ReadinessService) private readonly service: ReadinessService
  ) {}

  @Get("readiness")
  async get(@Req() request: ReadinessRequest) {
    return { data: await this.service.get(request.tenantAdminContext) };
  }

  @Post("publication")
  @HttpCode(200)
  async publish(@Req() request: ReadinessRequest, @Body() body: unknown) {
    emptyBody(body);
    try {
      return {
        data: await this.service.publish(request.tenantAdminContext)
      };
    } catch (error) {
      switch (databaseCode(error)) {
        case "PT100":
          // Sólo códigos y textos de la matriz: nunca el detalle de la base.
          throw new ConflictException({
            error: {
              code: "BUSINESS_NOT_READY",
              message:
                "Todavía faltan requisitos para publicar el negocio. Podés seguir guardando avances.",
              readiness: await this.service.get(request.tenantAdminContext)
            }
          });
        case "PT101":
          throw new ConflictException({
            error: {
              code: "BUSINESS_ALREADY_PUBLISHED",
              message: "El negocio ya está publicado."
            }
          });
        default:
          throw error;
      }
    }
  }

  @Post("sandbox/runs")
  @HttpCode(200)
  async runSandbox(@Req() request: ReadinessRequest, @Body() body: unknown) {
    emptyBody(body);
    try {
      return {
        data: await this.service.runSandbox(request.tenantAdminContext)
      };
    } catch (error) {
      if (databaseCode(error) === "PT102") {
        throw new UnprocessableEntityException({
          error: {
            code: "SANDBOX_PREREQUISITES_MISSING",
            message:
              "Para simular un pedido hace falta una mesa con QR vigente y una carta publicada."
          }
        });
      }
      throw error;
    }
  }

  @Delete("sandbox")
  async cleanupSandbox(@Req() request: ReadinessRequest) {
    return {
      data: {
        removed: await this.service.cleanupSandbox(request.tenantAdminContext)
      }
    };
  }
}
