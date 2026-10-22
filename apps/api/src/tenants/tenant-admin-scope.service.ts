import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { TenantHostContext, TenantScope } from "@platform/contracts";

import type { AdminIdentity } from "../auth/admin-auth.service.js";
import { TenantContextService } from "./tenant-context.service.js";

export type TenantAdminRequestContext = TenantHostContext & {
  identity: Pick<AdminIdentity, "assuranceLevel" | "userId">;
  role: "admin";
  scope: TenantScope;
};

@Injectable()
export class TenantAdminScopeService {
  constructor(
    @Inject(TenantContextService)
    private readonly tenantContextService: Pick<
      TenantContextService,
      "getForAuthenticatedIdentity"
    >
  ) {}

  async resolve(
    identity: AdminIdentity,
    hostContext: TenantHostContext
  ): Promise<TenantAdminRequestContext> {
    const access = await this.tenantContextService.getForAuthenticatedIdentity(
      identity.userId,
      identity.sessionId
    );
    if (access.type !== "tenant_admin") {
      throw new ForbiddenException({
        error: {
          code: "TENANT_ADMIN_REQUIRED",
          message: "Esta acción requiere acceso administrativo al negocio."
        }
      });
    }

    const membership = access.tenantContexts.find(
      (candidate) =>
        candidate.tenant.id === hostContext.tenant.id &&
        candidate.location.id === hostContext.location.id
    );
    if (!membership) {
      throw new NotFoundException({
        error: {
          code: "TENANT_NOT_FOUND",
          message: "No encontramos un negocio activo para esta dirección."
        }
      });
    }

    return {
      ...hostContext,
      identity: {
        assuranceLevel: identity.assuranceLevel,
        userId: identity.userId
      },
      role: membership.role,
      scope: {
        locationId: membership.location.id,
        tenantId: membership.tenant.id
      }
    };
  }
}
