import type { ReadinessReport, SandboxRun } from "@platform/contracts";
import type { ReadinessRepository } from "@platform/database";

import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";

export class ReadinessService {
  constructor(private readonly repository: ReadinessRepository) {}

  get(context: TenantAdminRequestContext): Promise<ReadinessReport> {
    return this.repository.get(context.scope, context.identity.userId);
  }

  publish(context: TenantAdminRequestContext): Promise<ReadinessReport> {
    return this.repository.publish(context.scope, context.identity.userId);
  }

  runSandbox(context: TenantAdminRequestContext): Promise<SandboxRun> {
    return this.repository.runSandbox(context.scope, context.identity.userId);
  }

  cleanupSandbox(context: TenantAdminRequestContext): Promise<number> {
    return this.repository.cleanupSandbox(
      context.scope,
      context.identity.userId
    );
  }
}
