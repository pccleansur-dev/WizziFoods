import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  parseTenantHostname,
  type TenantHostContext
} from "@platform/contracts";
import type { TenantDomainRepository } from "@platform/database";

@Injectable()
export class TenantHostService {
  constructor(
    @Inject("TENANT_DOMAIN_REPOSITORY")
    private readonly tenantDomainRepository: TenantDomainRepository,
    private readonly platformHostname: string
  ) {}

  async resolve(authority: unknown): Promise<TenantHostContext> {
    const hostname = parseTenantHostname(authority);
    if (!hostname) this.notFound();

    const context =
      await this.tenantDomainRepository.resolveByHostname(hostname);
    if (!context) this.notFound();

    return context;
  }

  async resolveForAdmin(
    authority: unknown,
    requesterId: string
  ): Promise<TenantHostContext> {
    const hostname = parseTenantHostname(authority);
    if (!hostname) this.notFound();

    let context = await this.tenantDomainRepository.resolveAdminByHostname(
      hostname,
      requesterId
    );
    if (!context && hostname === this.platformHostname) {
      context =
        await this.tenantDomainRepository.resolveSoleAdminTenant(requesterId);
    }
    if (!context) this.notFound();

    return context;
  }

  private notFound(): never {
    throw new NotFoundException({
      error: {
        code: "TENANT_NOT_FOUND",
        message: "No encontramos un negocio activo para esta dirección."
      }
    });
  }
}
