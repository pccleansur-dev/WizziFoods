import type {
  ProductionOrderStatus,
  WaiterInProgressItem
} from "@platform/contracts";

import { formatMoney } from "../app/m/[token]/diner-catalog-format";

export type ItemAction = "cancel" | "decide" | "deliver" | "propose";

/**
 * What the viewer can do with one item. Delivering belongs to the waiter,
 * resolving a shortage to the waiter (replace) and, for cancelling, only to a
 * manager and only while the item is not ready. The API and SQL enforce the same
 * rules; this only decides which buttons to show.
 */
export function itemActions(
  item: WaiterInProgressItem,
  isManager: boolean
): ItemAction[] {
  const actions: ItemAction[] = [];
  if (item.status === "ready") actions.push("deliver");
  if (item.status === "exception") {
    const open = item.adjustment;
    actions.push(
      open?.kind === "replacement" && open.status === "proposed"
        ? "decide"
        : "propose"
    );
  }
  if (
    isManager &&
    (item.status === "queued" ||
      item.status === "preparing" ||
      item.status === "exception")
  ) {
    actions.push("cancel");
  }
  return actions;
}

/** Items that are waiting for the waiter: ready to deliver or with a shortage. */
export function attentionCount(items: readonly WaiterInProgressItem[]): number {
  return items.filter(
    (item) => item.status === "ready" || item.status === "exception"
  ).length;
}

export function differenceLabel(cents: number): string {
  if (cents === 0) return "Sin diferencia de precio";
  return `${cents > 0 ? "Suma" : "Resta"} ${formatMoney(Math.abs(cents))}`;
}

const summaries: Record<ProductionOrderStatus, string> = {
  cancelled: "Cancelado",
  delivered: "Entregado",
  exception: "Hay un faltante",
  in_preparation: "En preparación",
  queued: "En cola",
  ready: "Listo para entregar"
};

export function orderStatusSummary(status: ProductionOrderStatus): string {
  return summaries[status];
}
