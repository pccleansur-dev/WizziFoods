import type { TenantHostContext } from "@platform/contracts";
import type { FloorPlanRepository } from "@platform/database";

export type TableEntryReason =
  "needs_cleaning" | "not_accepting" | "out_of_service";

export type TableEntry = {
  canCallWaiter: boolean;
  canConfirmOrder: boolean;
  /** The group the table belongs to: every table of it shares one party. */
  group: { name: string; tableLabels: string[] } | null;
  /** start: new table; join: an open table; view_only: menu and waiter only. */
  mode: "join" | "start" | "view_only";
  reason: TableEntryReason | null;
  table: { floorName: string; label: string; sectorName: string };
};

/** No token, no table id: the answer is only what the diner needs to see. */
export type TableEntryOutcome =
  | { entry: TableEntry; status: "ok" }
  | { status: "invalid" }
  | { status: "unavailable" };

export class TableEntryService {
  constructor(
    private readonly floorPlanRepository: Pick<
      FloorPlanRepository,
      "resolveTableEntry"
    >
  ) {}

  async resolve(
    context: TenantHostContext,
    token: string
  ): Promise<TableEntryOutcome> {
    const found = await this.floorPlanRepository.resolveTableEntry(
      { locationId: context.location.id, tenantId: context.tenant.id },
      token
    );
    if (!found) return { status: "invalid" };
    if (!found.published) return { status: "unavailable" };

    const table = {
      floorName: found.floorName,
      label: found.label,
      sectorName: found.sectorName
    };
    const group = found.group
      ? { name: found.group.name, tableLabels: found.group.tableLabels }
      : null;
    // A suspended business keeps serving the tables already seated but takes no
    // call from one nobody is using; it mirrors private.create_waiter_call.
    const canCallWaiter =
      found.serviceState === "occupied" || found.acceptsNewTables;
    const base = { canCallWaiter, group, table };

    if (found.serviceState === "occupied") {
      return {
        entry: { ...base, canConfirmOrder: true, mode: "join", reason: null },
        status: "ok"
      };
    }
    if (found.serviceState === "available" && found.acceptsNewTables) {
      return {
        entry: { ...base, canConfirmOrder: true, mode: "start", reason: null },
        status: "ok"
      };
    }
    const reason: TableEntryReason =
      found.serviceState === "available" ? "not_accepting" : found.serviceState;
    return {
      entry: { ...base, canConfirmOrder: false, mode: "view_only", reason },
      status: "ok"
    };
  }
}
