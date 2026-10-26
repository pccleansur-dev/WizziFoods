import type {
  JoinTablesCommand,
  SeparateTablesCommand
} from "@platform/contracts";
import type { TableRegroupingRepository } from "@platform/database";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";

export class TableRegroupingService {
  constructor(private readonly regrouping: TableRegroupingRepository) {}

  joinTables(context: StaffRequestContext, request: JoinTablesCommand) {
    return this.regrouping.joinTables({
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }

  separateTables(
    context: StaffRequestContext,
    groupId: string,
    request: SeparateTablesCommand
  ) {
    return this.regrouping.separateTables({
      groupId,
      request,
      scope: context.scope,
      staffId: context.staffId
    });
  }
}
