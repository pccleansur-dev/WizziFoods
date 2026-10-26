import type { TableClosingCommand } from "@platform/contracts";
import type { TableClosingRepository } from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export class TableClosingService {
  constructor(private readonly closing: TableClosingRepository) {}

  closeAccount(
    context: StaffRequestContext,
    sessionId: string,
    request: TableClosingCommand
  ) {
    return this.closing.closeAccount({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  cleanTable(
    context: StaffRequestContext,
    tableId: string,
    request: TableClosingCommand
  ) {
    return this.closing.cleanTable({
      request,
      scope: context.scope,
      staffId: context.staffId,
      tableId
    });
  }

  getClosedAccounts(context: StaffRequestContext) {
    return this.closing.getClosedAccounts({
      scope: context.scope,
      staffId: context.staffId
    });
  }

  getReceipt(context: StaffRequestContext, sessionId: string) {
    return this.closing.getReceipt({
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  requestCashier(
    context: StaffRequestContext,
    sessionId: string,
    request: TableClosingCommand
  ) {
    return this.closing.requestCashier({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }

  resolveCashierRequest(
    context: StaffRequestContext,
    requestId: string,
    request: TableClosingCommand
  ) {
    return this.closing.resolveCashierRequest({
      request,
      requestId,
      scope: context.scope,
      staffId: context.staffId
    });
  }
}
