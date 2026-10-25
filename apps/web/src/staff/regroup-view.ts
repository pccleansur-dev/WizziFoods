import type { WaiterSalonUnit } from "@platform/contracts";

/**
 * Why a unit of the salon cannot be added to the tables being joined, or null
 * when it can. The server checks everything again; this only keeps the waiter
 * from choosing something that is certain to be refused.
 */
export function joinBlockedReason(
  candidate: WaiterSalonUnit,
  picked: WaiterSalonUnit[]
): string | null {
  if (candidate.state === "needs_cleaning") {
    return "Espera limpieza: marcala limpia antes de unirla.";
  }
  if (candidate.state === "out_of_service") {
    return "Está fuera de servicio.";
  }
  if (candidate.tables.some((table) => !table.inScope)) {
    return "Incluye mesas de otro sector.";
  }
  if (picked.some((other) => other.floorId !== candidate.floorId)) {
    return "Está en otra planta.";
  }
  if (
    candidate.session !== null &&
    picked.some(
      (other) =>
        other.session !== null && other.session.id !== candidate.session?.id
    )
  ) {
    return "Tiene una cuenta abierta distinta: cerrá una antes de unirlas.";
  }
  return null;
}

/** One table per unit is enough: the server brings the rest of a group along. */
export function joinTableIds(units: WaiterSalonUnit[]): string[] {
  return units.flatMap((unit) => {
    const first = unit.tables.find((table) => table.inScope);
    return first ? [first.id] : [];
  });
}

export function joinSummary(units: WaiterSalonUnit[]): string {
  const labels = units.flatMap((unit) =>
    unit.tables.map((table) => table.label)
  );
  return `Mesas ${labels.join(" + ")}`;
}

/** Only a group whose tables the waiter serves entirely can be separated. */
export function canSeparate(unit: WaiterSalonUnit): boolean {
  return unit.kind === "group" && unit.tables.every((table) => table.inScope);
}

/** The tables that may keep the open account; empty when there is none. */
export function anchorChoices(
  unit: WaiterSalonUnit
): { id: string; label: string }[] {
  return unit.session === null
    ? []
    : unit.tables.map((table) => ({ id: table.id, label: table.label }));
}

export function separateSummary(
  unit: WaiterSalonUnit,
  anchorTableId: string | null
): string {
  const kept = unit.tables.find((table) => table.id === anchorTableId);
  if (unit.session === null || !kept) {
    return "Sin cuenta abierta: las mesas quedan sueltas y no cambia ningún estado.";
  }
  return `La cuenta abierta queda en la mesa ${kept.label}. Los pedidos, los pagos y el saldo no se mueven; las demás mesas quedan disponibles.`;
}
