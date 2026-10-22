import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable
} from "@nestjs/common";
import type { TenantHostContext } from "@platform/contracts";
import type { FastifyRequest } from "fastify";

import { TenantHostService } from "./tenant-host.service.js";

export type TenantHostRequest = FastifyRequest & {
  tenantHostContext: TenantHostContext;
};

type PendingTenantHostRequest = FastifyRequest & {
  tenantHostContext?: TenantHostContext;
};

@Injectable()
export class TenantHostGuard implements CanActivate {
  constructor(
    @Inject(TenantHostService)
    private readonly tenantHostService: TenantHostService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PendingTenantHostRequest>();
    request.tenantHostContext = await this.tenantHostService.resolve(
      request.headers.host
    );
    return true;
  }
}
