import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import {
  parseAvailabilityRequest,
  parseCatalogDraftRequest,
  parseCatalogProductId,
  parsePublishCatalogRequest
} from "./catalog-input.js";
import { CatalogService } from "./catalog.service.js";

type AdminCatalogRequest = Pick<TenantAdminScopedRequest, "tenantAdminContext">;
type PublicCatalogRequest = Pick<TenantHostRequest, "tenantHostContext">;

function invalidCatalog(code: string, error: unknown): BadRequestException {
  return new BadRequestException({
    error: { code, message: (error as Error).message }
  });
}

function rethrowConflict(error: unknown): void {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40001"
  ) {
    throw new ConflictException({
      error: {
        code: "CATALOG_VERSION_CONFLICT",
        message:
          "La carta cambió desde la última lectura. Actualizá los datos e intentá nuevamente."
      }
    });
  }
}

@Controller("v1/tenant/catalog")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class CatalogAdminController {
  constructor(
    @Inject(CatalogService) private readonly service: CatalogService
  ) {}

  @Get("current")
  async getCurrent(@Req() request: AdminCatalogRequest) {
    return {
      data: await this.service.getAdminCurrent(request.tenantAdminContext)
    };
  }

  @Get("draft")
  async getDraft(@Req() request: AdminCatalogRequest) {
    return { data: await this.service.getDraft(request.tenantAdminContext) };
  }

  @Put("draft")
  async saveDraft(@Req() request: AdminCatalogRequest, @Body() body: unknown) {
    try {
      return {
        data: await this.service.saveDraft(
          request.tenantAdminContext,
          parseCatalogDraftRequest(body)
        )
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      rethrowConflict(error);
      if ((error as Error).message === "Datos de la carta inválidos.") {
        throw invalidCatalog("INVALID_CATALOG_DRAFT", error);
      }
      throw error;
    }
  }

  @Post("publish")
  async publish(@Req() request: AdminCatalogRequest, @Body() body: unknown) {
    let parsed;
    try {
      parsed = parsePublishCatalogRequest(body);
    } catch (error) {
      throw invalidCatalog("INVALID_CATALOG_PUBLICATION", error);
    }
    try {
      return {
        data: await this.service.publish(request.tenantAdminContext, parsed)
      };
    } catch (error) {
      rethrowConflict(error);
      throw error;
    }
  }

  @Patch("products/:productId/availability")
  async setAvailability(
    @Req() request: AdminCatalogRequest,
    @Param("productId") untrustedProductId: unknown,
    @Body() body: unknown
  ) {
    let parsed;
    let productId;
    try {
      parsed = parseAvailabilityRequest(body);
      productId = parseCatalogProductId(untrustedProductId);
    } catch (error) {
      throw invalidCatalog("INVALID_CATALOG_AVAILABILITY", error);
    }
    try {
      return {
        data: await this.service.setAvailability(
          request.tenantAdminContext,
          productId,
          parsed
        )
      };
    } catch (error) {
      rethrowConflict(error);
      throw error;
    }
  }
}

@Controller("v1/public/catalog")
@UseGuards(TenantHostGuard)
export class PublicCatalogController {
  constructor(
    @Inject(CatalogService) private readonly service: CatalogService
  ) {}

  @Get()
  async get(@Req() request: PublicCatalogRequest) {
    return { data: await this.service.getCurrent(request.tenantHostContext) };
  }
}
