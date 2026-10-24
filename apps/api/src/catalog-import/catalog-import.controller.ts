import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeGuard,
  type TenantAdminScopedRequest
} from "../tenants/tenant-admin-scope.guard.js";
import { TenantHostGuard } from "../tenants/tenant-host.guard.js";
import {
  parseCatalogImportApproval,
  parseCatalogImportId,
  parseCatalogImportSubmission
} from "./catalog-import-input.js";
import { CatalogImportService } from "./catalog-import.service.js";

type ImportRequest = Pick<TenantAdminScopedRequest, "tenantAdminContext">;

function invalid(error: unknown): BadRequestException {
  return new BadRequestException({
    error: {
      code: "INVALID_CATALOG_IMPORT",
      message: error instanceof Error ? error.message : "Importación inválida."
    }
  });
}

@Controller("v1/tenant/catalog-imports")
@UseGuards(AdminAuthGuard, TenantHostGuard, TenantAdminScopeGuard)
export class CatalogImportController {
  constructor(
    @Inject(CatalogImportService) private readonly service: CatalogImportService
  ) {}

  @Get()
  async list(@Req() request: ImportRequest) {
    return { data: await this.service.list(request.tenantAdminContext) };
  }

  @Get(":importId")
  async get(@Req() request: ImportRequest, @Param("importId") rawId: unknown) {
    try {
      return {
        data: await this.service.get(
          request.tenantAdminContext,
          parseCatalogImportId(rawId)
        )
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw invalid(error);
    }
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async enqueue(@Req() request: ImportRequest, @Body() body: unknown) {
    try {
      return {
        data: await this.service.enqueue(
          request.tenantAdminContext,
          parseCatalogImportSubmission(body)
        )
      };
    } catch (error) {
      throw invalid(error);
    }
  }

  @Post(":importId/approve")
  async approve(
    @Req() request: ImportRequest,
    @Param("importId") rawId: unknown,
    @Body() body: unknown
  ) {
    try {
      return {
        data: await this.service.approve(
          request.tenantAdminContext,
          parseCatalogImportId(rawId),
          parseCatalogImportApproval(body)
        )
      };
    } catch (error) {
      throw invalid(error);
    }
  }

  @Post(":importId/discard")
  async discard(
    @Req() request: ImportRequest,
    @Param("importId") rawId: unknown
  ) {
    try {
      return {
        data: await this.service.discard(
          request.tenantAdminContext,
          parseCatalogImportId(rawId)
        )
      };
    } catch (error) {
      throw invalid(error);
    }
  }
}
