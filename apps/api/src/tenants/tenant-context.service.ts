import type { TenantContext, TenantRepository } from "@platform/database";

export class TenantContextService {
  constructor(private readonly tenantRepository: TenantRepository) {}

  getForAuthenticatedIdentity(userId: string): Promise<TenantContext[]> {
    return this.tenantRepository.findForIdentity(userId);
  }
}
