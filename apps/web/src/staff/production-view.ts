import type {
  ProductionAdvanceTarget,
  ProductionItemStatus,
  ProductionOrderStatus,
  ProductionTicket
} from "@platform/contracts";

const statusLabels: Record<
  ProductionItemStatus | ProductionOrderStatus,
  string
> = {
  cancelled: "Cancelado",
  delivered: "Entregado",
  exception: "Faltante",
  in_preparation: "En preparación",
  preparing: "En preparación",
  queued: "En cola",
  ready: "Listo",
  replaced: "Reemplazado"
};

const completed = new Set(["cancelled", "delivered", "ready"]);

export function productionStatusLabel(
  status: ProductionItemStatus | ProductionOrderStatus
): string {
  return statusLabels[status];
}

/** The only move an item allows: one step forward, never back or sideways. */
export function nextProductionStep(
  status: ProductionItemStatus
): { label: string; target: ProductionAdvanceTarget } | null {
  if (status === "queued") {
    return { label: "Empezar a preparar", target: "preparing" };
  }
  if (status === "preparing") {
    return { label: "Marcar listo", target: "ready" };
  }
  return null;
}

/** Active tickets first, oldest first; completed ones close the list. */
export function sortProductionTickets(
  tickets: readonly ProductionTicket[]
): ProductionTicket[] {
  return [...tickets].sort(
    (left, right) =>
      Number(completed.has(left.status)) -
        Number(completed.has(right.status)) ||
      Date.parse(left.confirmedAt) - Date.parse(right.confirmedAt)
  );
}
