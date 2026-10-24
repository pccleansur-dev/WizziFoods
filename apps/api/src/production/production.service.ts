import type { ProductionAdvanceRequest } from "@platform/contracts";
import type { ProductionRepository } from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export class ProductionService {
  constructor(private readonly production: ProductionRepository) {}

  getBoard(context: StaffRequestContext) {
    return this.production.getBoard({
      scope: context.scope,
      staffId: context.staffId
    });
  }

  advanceItem(
    context: StaffRequestContext,
    orderId: string,
    lineId: string,
    request: ProductionAdvanceRequest
  ) {
    return this.production.advanceItem({
      lineId,
      orderId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }
}
