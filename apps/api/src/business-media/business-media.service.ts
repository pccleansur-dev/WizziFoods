import { Injectable } from "@nestjs/common";
import type {
  BusinessMediaRepository,
  ReservedBusinessMedia
} from "@platform/database";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";
import type { BusinessMediaReservationRequest } from "./business-media-input.js";
import type { BusinessMediaStorageGateway } from "./business-media-storage.gateway.js";

@Injectable()
export class BusinessMediaService {
  constructor(
    private readonly repository: BusinessMediaRepository,
    private readonly storage: BusinessMediaStorageGateway
  ) {}

  async getStatus(context: TenantAdminRequestContext, assetId: string) {
    const result = await this.repository.getStatus({
      assetId,
      requesterId: context.identity.userId,
      scope: context.scope
    });
    return {
      assetId: result.id,
      kind: result.kind,
      status: result.status
    };
  }

  async queue(context: TenantAdminRequestContext, assetId: string) {
    const result = await this.repository.queue({
      assetId,
      requesterId: context.identity.userId,
      scope: context.scope
    });
    return {
      assetId: result.id,
      status: result.status === "reserved" ? "processing" : result.status
    };
  }

  async reserve(
    context: TenantAdminRequestContext,
    request: BusinessMediaReservationRequest
  ): Promise<ReservedBusinessMedia & { uploadUrl: string }> {
    const reservation = await this.repository.reserve({
      ...request,
      requesterId: context.identity.userId,
      scope: context.scope
    });
    const uploadUrl = await this.storage.createUploadUrl(
      reservation.objectPath
    );
    return { ...reservation, uploadUrl };
  }
}
