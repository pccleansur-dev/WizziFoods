import {
  parseFloorPlanCommand,
  parseFloorPlanDraft,
  parseTenantScope,
  type FloorPlanCommand,
  type FloorPlanDraft,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type FloorPlanRecord = {
  plan: FloorPlanDraft;
  version: number;
};

export type FloorPlanSaveRecord = FloorPlanRecord & { applied: boolean };

export type FloorTableQrCode = {
  label: string;
  tableId: string;
  token: string;
};

export type FloorTableQrResolution = {
  /** The group the table is part of: its QR then stands for the whole group. */
  group: { id: string; name: string; tableLabels: string[] } | null;
  label: string;
  sectorName: string;
  tableId: string;
};

export type FloorPlanReadiness = {
  activeTables: number;
  ready: boolean;
  tablesWithQr: number;
};

export type SaveFloorPlanInput = {
  command: FloorPlanCommand;
  requesterId: string;
  scope: TenantScope;
};

export type RotateFloorTableQrInput = {
  requesterId: string;
  scope: TenantScope;
  tableId: string;
};

export interface FloorPlanRepository {
  getPlan(scope: TenantScope, requesterId: string): Promise<FloorPlanRecord>;
  getReadiness(scope: TenantScope): Promise<FloorPlanReadiness>;
  listQrCodes(
    scope: TenantScope,
    requesterId: string
  ): Promise<FloorTableQrCode[]>;
  resolveQr(
    scope: TenantScope,
    token: string
  ): Promise<FloorTableQrResolution | null>;
  rotateQr(input: RotateFloorTableQrInput): Promise<void>;
  savePlan(input: SaveFloorPlanInput): Promise<FloorPlanSaveRecord>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const tokenPattern = /^[0-9a-f]{64}$/u;

function assertScope(scope: TenantScope): TenantScope {
  const parsed = parseTenantScope(scope);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertUuid(value: string, field: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${field} must be a UUID`);
}

function mapRecord(value: unknown): FloorPlanRecord {
  const root =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const parsed = root ? parseFloorPlanDraft(root.plan) : null;
  if (
    !root ||
    !parsed?.ok ||
    !Number.isSafeInteger(root.version) ||
    (root.version as number) < 0
  ) {
    throw new Error("floor plan must be canonical");
  }
  return { plan: parsed.plan, version: root.version as number };
}

type PlanRow = { result: unknown };
type SaveRow = { applied: boolean; result: unknown };
type QrRow = { label: string; table_id: string; token: string };
type ResolveRow = {
  group_id: string | null;
  group_name: string | null;
  group_table_labels: string[] | null;
  label: string;
  sector_name: string;
  table_id: string;
};
type ReadinessRow = { active_tables: number; tables_with_qr: number };

export function createFloorPlanRepository(client: Sql): FloorPlanRepository {
  return {
    async getPlan(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertUuid(requesterId, "requesterId");
      const [row] = await client<PlanRow[]>`
        select private.get_floor_plan(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        ) as result
      `;
      if (!row) throw new Error("Floor plan read did not return a record");
      return mapRecord(row.result);
    },

    async getReadiness(untrustedScope) {
      const scope = assertScope(untrustedScope);
      const [row] = await client<ReadinessRow[]>`
        select *
        from private.floor_plan_readiness(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid
        )
      `;
      const activeTables = row?.active_tables ?? 0;
      const tablesWithQr = row?.tables_with_qr ?? 0;
      return {
        activeTables,
        ready: activeTables > 0 && tablesWithQr === activeTables,
        tablesWithQr
      };
    },

    async listQrCodes(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertUuid(requesterId, "requesterId");
      const rows = await client<QrRow[]>`
        select *
        from private.list_floor_table_qr_codes(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        )
      `;
      return rows.map((row) => ({
        label: row.label,
        tableId: row.table_id,
        token: row.token
      }));
    },

    async resolveQr(untrustedScope, token) {
      const scope = assertScope(untrustedScope);
      if (typeof token !== "string" || !tokenPattern.test(token)) return null;
      const [row] = await client<ResolveRow[]>`
        select *
        from private.resolve_floor_table_qr(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${token}
        )
      `;
      return row
        ? {
            group:
              row.group_id && row.group_name
                ? {
                    id: row.group_id,
                    name: row.group_name,
                    tableLabels: row.group_table_labels ?? []
                  }
                : null,
            label: row.label,
            sectorName: row.sector_name,
            tableId: row.table_id
          }
        : null;
    },

    async rotateQr(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      assertUuid(input.tableId, "tableId");
      await client`
        select private.rotate_floor_table_qr(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${input.tableId}::uuid
        )
      `;
    },

    async savePlan(input) {
      const scope = assertScope(input.scope);
      assertUuid(input.requesterId, "requesterId");
      const parsed = parseFloorPlanCommand(input.command);
      if (!parsed.ok) throw new Error("floor plan command must be canonical");
      const { command } = parsed;
      const [row] = await client<SaveRow[]>`
        select *
        from private.save_floor_plan(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${command.commandId}::uuid,
          ${command.expectedVersion},
          ${JSON.stringify(command.plan)}::jsonb
        )
      `;
      if (!row) throw new Error("Floor plan save did not return a record");
      return { ...mapRecord(row.result), applied: row.applied };
    }
  };
}
