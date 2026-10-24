import type {
  CancelItemRequest,
  DeliverItemRequest,
  ProductionExceptionRequest,
  ReplacementDecisionRequest,
  ReplacementProposalRequest
} from "@platform/contracts";
import type { OrderAdjustmentsRepository } from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export class OrderAdjustmentsService {
  constructor(private readonly adjustments: OrderAdjustmentsRepository) {}

  getOrders(context: StaffRequestContext) {
    return this.adjustments.getOrders({
      scope: context.scope,
      staffId: context.staffId
    });
  }

  deliverItem(
    context: StaffRequestContext,
    orderId: string,
    lineId: string,
    request: DeliverItemRequest
  ) {
    return this.adjustments.deliverItem({
      lineId,
      orderId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  reportException(
    context: StaffRequestContext,
    orderId: string,
    lineId: string,
    request: ProductionExceptionRequest
  ) {
    return this.adjustments.reportException({
      lineId,
      orderId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  proposeReplacement(
    context: StaffRequestContext,
    orderId: string,
    lineId: string,
    request: ReplacementProposalRequest
  ) {
    return this.adjustments.proposeReplacement({
      lineId,
      orderId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  decideReplacement(
    context: StaffRequestContext,
    adjustmentId: string,
    request: ReplacementDecisionRequest
  ) {
    return this.adjustments.decideReplacement({
      adjustmentId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  cancelItem(
    context: StaffRequestContext,
    orderId: string,
    lineId: string,
    request: CancelItemRequest
  ) {
    return this.adjustments.cancelItem({
      lineId,
      orderId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }
}
