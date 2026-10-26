import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { parseBrandIconSize } from "@platform/contracts";
import type { FastifyReply } from "fastify";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { BrandService } from "./brand.service.js";

function scopeOf(request: TenantHostRequest) {
  return {
    locationId: request.tenantHostContext.location.id,
    tenantId: request.tenantHostContext.tenant.id
  };
}

/**
 * The name, colors and icon of the restaurant of THIS host, for the installed app. Public:
 * it is what the restaurant's own page already shows. Nothing here takes a tenant from the
 * request, and no page of the menu or the login waits for it.
 */
@Controller("v1/public/brand")
@UseGuards(TenantHostGuard)
export class BrandController {
  constructor(@Inject(BrandService) private readonly service: BrandService) {}

  @Get()
  async view(@Req() request: TenantHostRequest) {
    const view = await this.service.view(scopeOf(request));
    if (!view) throw new NotFoundException();
    return { data: view };
  }

  @Get("icon")
  async icon(
    @Req() request: TenantHostRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query("size") size?: string,
    @Query("maskable") maskable?: string
  ) {
    const parsed = parseBrandIconSize(size);
    if (!parsed || (maskable !== undefined && maskable !== "1")) {
      throw new BadRequestException({
        error: { code: "INVALID_ICON", message: "Tamaño de ícono inválido." }
      });
    }
    const png = await this.service.icon(
      scopeOf(request),
      parsed,
      maskable === "1"
    );
    if (!png) throw new NotFoundException();
    void reply
      .header("content-type", "image/png")
      // The manifest asks with the logo version, so a new logo gets a new address.
      .header("cache-control", "public, max-age=86400");
    return png;
  }
}
