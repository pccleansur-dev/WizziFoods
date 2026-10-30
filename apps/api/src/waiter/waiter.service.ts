import type {
  WaiterCallClaimRequest,
  WaiterCallResolveRequest,
  WaiterIntentDecisionRequest,
  WaiterManualOrderRequest
} from "@platform/contracts";
import type {
  CatalogRepository,
  WaiterOperationsRepository
} from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export class WaiterService {
  constructor(
    private readonly operations: WaiterOperationsRepository,
    private readonly catalog: CatalogRepository
  ) {}

  getSalon(context: StaffRequestContext) {
    return this.operations.getSalon({
      scope: context.scope,
      staffId: context.staffId
    });
  }

  claimCall(
    context: StaffRequestContext,
    callId: string,
    request: WaiterCallClaimRequest
  ) {
    return this.operations.claimCall({
      callId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  resolveCall(
    context: StaffRequestContext,
    callId: string,
    request: WaiterCallResolveRequest
  ) {
    return this.operations.resolveCall({
      callId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  decideIntent(
    context: StaffRequestContext,
    intentId: string,
    request: WaiterIntentDecisionRequest
  ) {
    return this.operations.decideIntent({
      intentId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  createManualOrder(
    context: StaffRequestContext,
    request: WaiterManualOrderRequest
  ) {
    return this.operations.createManualOrder({
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  /** The published menu with live availability; prices are only displayed. */
  getMenu(context: StaffRequestContext) {
    return this.catalog.getCurrent(context.scope);
  }
}
