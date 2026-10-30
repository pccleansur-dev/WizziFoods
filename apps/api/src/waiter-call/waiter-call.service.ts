import type {
  DinerWaiterCallRequest,
  TenantHostContext
} from "@platform/contracts";
import type { WaiterCallRepository } from "@platform/database";

export class WaiterCallService {
  constructor(private readonly repository: WaiterCallRepository) {}

  /** Tenant and location come only from the host; the table from the token. */
  create(context: TenantHostContext, request: DinerWaiterCallRequest) {
    return this.repository.create({
      request,
      scope: {
        locationId: context.location.id,
        tenantId: context.tenant.id
      }
    });
  }
}
