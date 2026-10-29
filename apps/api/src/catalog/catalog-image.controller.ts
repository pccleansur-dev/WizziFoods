import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { parseCatalogImageAssetId } from "@platform/contracts";
import type { FastifyReply } from "fastify";

import {
  TenantHostGuard,
  type TenantHostRequest
} from "../tenants/tenant-host.guard.js";
import { CatalogImageService } from "./catalog-image.service.js";

/**
 * The photo of a product of the published menu of THIS host. Public, like the menu itself.
 * The restaurant comes only from the host; the address names the photo, and a photo that
 * the host's current menu does not use answers 404, the same as one that does not exist.
 */
@Controller("v1/public/catalog/images")
@UseGuards(TenantHostGuard)
export class CatalogImageController {
  constructor(
    @Inject(CatalogImageService) private readonly service: CatalogImageService
  ) {}

  @Get(":assetId")
  async image(
    @Req() request: TenantHostRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("assetId") assetId: string
  ) {
    const id = parseCatalogImageAssetId(assetId);
    if (!id) throw new NotFoundException();
    const image = await this.service.image(
      {
        locationId: request.tenantHostContext.location.id,
        tenantId: request.tenantHostContext.tenant.id
      },
      id
    );
    if (!image) throw new NotFoundException();
    void reply
      .header("content-type", image.contentType)
      .header("x-content-type-options", "nosniff")
      // A photo has its own id and never changes; a new photo is a new address.
      .header("cache-control", "public, max-age=86400")
      .header("etag", `"${image.version}"`);
    return image.bytes;
  }
}
