import type {
  CashMovementRequest,
  CloseShiftRequest,
  OpenShiftRequest,
  RefundRequest
} from "@platform/contracts";
import type { CashRegisterRepository } from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export class CashRegisterService {
  constructor(private readonly register: CashRegisterRepository) {}

  getRegister(context: StaffRequestContext) {
    return this.register.getRegister({
      scope: context.scope,
      staffId: context.staffId
    });
  }

  openShift(context: StaffRequestContext, request: OpenShiftRequest) {
    return this.register.openShift({
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  recordMovement(context: StaffRequestContext, request: CashMovementRequest) {
    return this.register.recordMovement({
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  closeShift(context: StaffRequestContext, request: CloseShiftRequest) {
    return this.register.closeShift({
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  recordRefund(
    context: StaffRequestContext,
    sessionId: string,
    request: RefundRequest
  ) {
    return this.register.recordRefund({
      request,
      scope: context.scope,
      sessionId,
      staffId: context.staffId
    });
  }
}
