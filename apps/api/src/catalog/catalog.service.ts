import { Injectable } from "@nestjs/common";
import type { CatalogDraft, TenantHostContext } from "@platform/contracts";
import type {
  CatalogDraftRecord,
  CatalogPublicationRecord,
  CatalogRepository,
  PublishedCatalogRecord
} from "@platform/database";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";
import type {
  AvailabilityRequest,
  PublishCatalogRequest
} from "./catalog-input.js";

@Injectable()
export class CatalogService {
  constructor(private readonly catalogRepository: CatalogRepository) {}

  getCurrent(
    context: TenantHostContext
  ): Promise<PublishedCatalogRecord | null> {
    return this.catalogRepository.getCurrent({
      locationId: context.location.id,
      tenantId: context.tenant.id
    });
  }

  getAdminCurrent(
    context: TenantAdminRequestContext
  ): Promise<PublishedCatalogRecord | null> {
    return this.catalogRepository.getCurrent(context.scope);
  }

  getDraft(
    context: TenantAdminRequestContext
  ): Promise<CatalogDraftRecord | null> {
    return this.catalogRepository.getDraft(
      context.scope,
      context.identity.userId
    );
  }

  publish(
    context: TenantAdminRequestContext,
    request: PublishCatalogRequest
  ): Promise<CatalogPublicationRecord> {
    return this.catalogRepository.publish({
      expectedDraftRevision: request.expectedDraftRevision,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  saveDraft(
    context: TenantAdminRequestContext,
    draft: CatalogDraft
  ): Promise<CatalogDraftRecord> {
    return this.catalogRepository.saveDraft({
      draft,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  setAvailability(
    context: TenantAdminRequestContext,
    productId: string,
    request: AvailabilityRequest
  ) {
    return this.catalogRepository.setAvailability({
      ...request,
      productId,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }
}
