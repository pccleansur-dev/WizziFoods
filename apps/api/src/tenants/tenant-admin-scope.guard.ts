import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable
} from "@nestjs/common";

import type { AdminAuthenticatedRequest } from "../auth/admin-auth.guard.js";
import {
  TenantAdminScopeService,
  type TenantAdminRequestContext
} from "./tenant-admin-scope.service.js";
import type { TenantHostRequest } from "./tenant-host.guard.js";

export type TenantAdminScopedRequest = AdminAuthenticatedRequest &
  TenantHostRequest & {
    tenantAdminContext: TenantAdminRequestContext;
  };

type PendingTenantAdminRequest = AdminAuthenticatedRequest &
  TenantHostRequest & {
    tenantAdminContext?: TenantAdminRequestContext;
  };

@Injectable()
export class TenantAdminScopeGuard implements CanActivate {
  constructor(
    @Inject(TenantAdminScopeService)
    private readonly tenantAdminScopeService: TenantAdminScopeService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PendingTenantAdminRequest>();
    request.tenantAdminContext = await this.tenantAdminScopeService.resolve(
      request.adminIdentity,
      request.tenantHostContext
    );
    return true;
  }
}
