import type {
  ApplyDiscountRequest,
  CreateSplitRequest,
  PaySharesRequest,
  KeepOpenRequest,
  RecordPaymentRequest
} from "@platform/contracts";
import type { TableAccountsRepository } from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export class TableAccountsService {
  constructor(private readonly accounts: TableAccountsRepository) {}

  getAccounts(context: StaffRequestContext) {
    return this.accounts.getAccounts({
      scope: context.scope,
      staffId: context.staffId
    });
  }

  createSplit(
    context: StaffRequestContext,
    sessionId: string,
    request: CreateSplitRequest
  ) {
    return this.accounts.createSplit({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  paySplitShares(
    context: StaffRequestContext,
    sessionId: string,
    request: PaySharesRequest
  ) {
    return this.accounts.paySplitShares({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  recordPayment(
    context: StaffRequestContext,
    sessionId: string,
    request: RecordPaymentRequest
  ) {
    return this.accounts.recordPayment({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  applyDiscount(
    context: StaffRequestContext,
    sessionId: string,
    request: ApplyDiscountRequest
  ) {
    return this.accounts.applyDiscount({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  keepOpen(
    context: StaffRequestContext,
    sessionId: string,
    request: KeepOpenRequest
  ) {
    return this.accounts.keepOpen({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }
}
