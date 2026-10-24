import type {
  OrderIntentRequest,
  TenantHostContext
} from "@platform/contracts";
import type { OrderIntentRepository } from "@platform/database";

export class OrderIntentService {
  constructor(private readonly repository: OrderIntentRepository) {}

  create(context: TenantHostContext, request: OrderIntentRequest) {
    return this.repository.create({
      request,
      scope: {
        locationId: context.location.id,
        tenantId: context.tenant.id
      }
    });
  }

  listPaymentMethods(context: TenantHostContext) {
    return this.repository.listPaymentMethods({
      locationId: context.location.id,
      tenantId: context.tenant.id
    });
  }
}
