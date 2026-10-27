import postgres from "postgres";

import {
  adjustmentsSlug,
  seedAdjustmentsBusiness,
  type AdjustmentsBusiness
} from "./adjustments-data";
import { ownerDatabaseUrl } from "./stack-env";

export type ConnectivityBusiness = AdjustmentsBusiness & {
  /** Status of every production item of the business, oldest first. */
  itemStatuses(): Promise<string[]>;
  /** How many orders the diners have sent for confirmation. */
  intents(): Promise<number>;
  /** How many times an item moved forward, and with how many different commands. */
  transitions(): Promise<{ commands: number; events: number }>;
};

/**
 * The adjustments business (kitchen Coco, bar Beto, waiter Ana, manager Marta; tables 5
 * and 6) plus questions about what production recorded.
 */
export async function seedConnectivityBusiness(): Promise<ConnectivityBusiness> {
  const base = await seedAdjustmentsBusiness({ openRegister: false });
  const owner = postgres(ownerDatabaseUrl(), { prepare: false });
  const [tenant] = await owner<{ id: string }[]>`
    select id from public.tenants where slug = ${adjustmentsSlug}`;
  const tenantId = tenant!.id;
  return {
    ...base,
    async close() {
      await owner.end();
      await base.close();
    },
    async intents() {
      const [row] = await owner<{ total: number }[]>`
        select count(*)::int as total from private.order_intents
        where tenant_id = ${tenantId}`;
      return row!.total;
    },
    async itemStatuses() {
      const rows = await owner<{ status: string }[]>`
        select status from private.production_items
        where tenant_id = ${tenantId} order by queued_at, line_id`;
      return rows.map((row) => row.status);
    },
    async transitions() {
      const [row] = await owner<{ commands: number; events: number }[]>`
        select count(*)::int as events, count(distinct command_id)::int as commands
        from private.production_item_events where tenant_id = ${tenantId}`;
      return row!;
    }
  };
}
