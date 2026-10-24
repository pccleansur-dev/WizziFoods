import {
  FLOOR_PLAN_LIMITS,
  type FloorPlanDraft,
  type FloorSeatLayout,
  type FloorTable,
  type FloorTableShape
} from "@platform/contracts";

const SEAT_GAP = 18;
const GRID_STEP = 180;
const GRID_ORIGIN = 40;

export function createEmptyFloorPlan(): FloorPlanDraft {
  return { groups: [], sectors: [], tables: [] };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function integer(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function isSquareShape(shape: FloorTableShape): boolean {
  return shape === "round" || shape === "square";
}

export function addSector(
  plan: FloorPlanDraft,
  name: string,
  id: string
): FloorPlanDraft {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || plan.sectors.length >= FLOOR_PLAN_LIMITS.maxSectors) {
    return plan;
  }
  return {
    ...plan,
    sectors: [
      ...plan.sectors,
      { id, name: trimmed, position: plan.sectors.length }
    ]
  };
}

export function renameSector(
  plan: FloorPlanDraft,
  sectorId: string,
  name: string
): FloorPlanDraft {
  return {
    ...plan,
    sectors: plan.sectors.map((sector) =>
      sector.id === sectorId ? { ...sector, name: name.slice(0, 60) } : sector
    )
  };
}

/** A sector can only be removed once no table still belongs to it. */
export function removeSector(
  plan: FloorPlanDraft,
  sectorId: string
): FloorPlanDraft {
  if (plan.tables.some((table) => table.sectorId === sectorId)) return plan;
  return {
    ...plan,
    sectors: plan.sectors
      .filter((sector) => sector.id !== sectorId)
      .map((sector, position) => ({ ...sector, position }))
  };
}

function nextLabel(plan: FloorPlanDraft): string {
  const used = new Set(plan.tables.map(({ label }) => label.toLowerCase()));
  for (let candidate = 1; ; candidate += 1) {
    if (!used.has(String(candidate))) return String(candidate);
  }
}

function overlaps(
  plan: FloorPlanDraft,
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  return plan.tables.some(
    (table) =>
      x < table.x + table.width + SEAT_GAP * 2 &&
      x + width + SEAT_GAP * 2 > table.x &&
      y < table.y + table.height + SEAT_GAP * 2 &&
      y + height + SEAT_GAP * 2 > table.y
  );
}

function freeSpot(
  plan: FloorPlanDraft,
  width: number,
  height: number
): { x: number; y: number } {
  const columns = Math.floor(
    (FLOOR_PLAN_LIMITS.canvasWidth - GRID_ORIGIN) / GRID_STEP
  );
  const rows = Math.floor(
    (FLOOR_PLAN_LIMITS.canvasHeight - GRID_ORIGIN) / GRID_STEP
  );
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = GRID_ORIGIN + column * GRID_STEP;
      const y = GRID_ORIGIN + row * GRID_STEP;
      if (
        x + width <= FLOOR_PLAN_LIMITS.canvasWidth &&
        y + height <= FLOOR_PLAN_LIMITS.canvasHeight &&
        !overlaps(plan, x, y, width, height)
      ) {
        return { x, y };
      }
    }
  }
  return { x: GRID_ORIGIN, y: GRID_ORIGIN };
}

export function addTable(
  plan: FloorPlanDraft,
  input: { id: string; sectorId: string; shape: FloorTableShape }
): FloorPlanDraft {
  if (
    plan.tables.length >= FLOOR_PLAN_LIMITS.maxTables ||
    !plan.sectors.some(({ id }) => id === input.sectorId)
  ) {
    return plan;
  }
  const rectangle = input.shape === "rectangle";
  const width = rectangle ? 160 : 100;
  const height = rectangle ? 90 : 100;
  const table: FloorTable = {
    height,
    id: input.id,
    label: nextLabel(plan),
    rotation: 0,
    seatCount: rectangle ? 6 : 4,
    seatLayout: rectangle ? "long-sides" : "perimeter",
    sectorId: input.sectorId,
    shape: input.shape,
    width,
    ...freeSpot(plan, width, height)
  };
  return { ...plan, tables: [...plan.tables, table] };
}

function mapTable(
  plan: FloorPlanDraft,
  tableId: string,
  change: (table: FloorTable) => FloorTable
): FloorPlanDraft {
  if (!plan.tables.some(({ id }) => id === tableId)) return plan;
  return {
    ...plan,
    tables: plan.tables.map((table) =>
      table.id === tableId ? change(table) : table
    )
  };
}

export function moveTable(
  plan: FloorPlanDraft,
  tableId: string,
  x: number,
  y: number
): FloorPlanDraft {
  return mapTable(plan, tableId, (table) => ({
    ...table,
    x: clamp(integer(x), 0, FLOOR_PLAN_LIMITS.canvasWidth - table.width),
    y: clamp(integer(y), 0, FLOOR_PLAN_LIMITS.canvasHeight - table.height)
  }));
}

export function nudgeTable(
  plan: FloorPlanDraft,
  tableId: string,
  dx: number,
  dy: number
): FloorPlanDraft {
  const table = plan.tables.find(({ id }) => id === tableId);
  return table ? moveTable(plan, tableId, table.x + dx, table.y + dy) : plan;
}

export function resizeTable(
  plan: FloorPlanDraft,
  tableId: string,
  width: number,
  height: number
): FloorPlanDraft {
  const { minTableSize, maxTableSize } = FLOOR_PLAN_LIMITS;
  return mapTable(plan, tableId, (table) => {
    const nextWidth = clamp(integer(width), minTableSize, maxTableSize);
    const nextHeight = isSquareShape(table.shape)
      ? nextWidth
      : clamp(integer(height), minTableSize, maxTableSize);
    return {
      ...table,
      height: nextHeight,
      width: nextWidth,
      x: clamp(table.x, 0, FLOOR_PLAN_LIMITS.canvasWidth - nextWidth),
      y: clamp(table.y, 0, FLOOR_PLAN_LIMITS.canvasHeight - nextHeight)
    };
  });
}

export type TableEdit = Partial<
  Pick<
    FloorTable,
    "label" | "rotation" | "seatCount" | "seatLayout" | "sectorId" | "shape"
  >
>;

export function updateTable(
  plan: FloorPlanDraft,
  tableId: string,
  edit: TableEdit
): FloorPlanDraft {
  return mapTable(plan, tableId, (table) => {
    let next: FloorTable = { ...table, ...edit };
    if (edit.rotation !== undefined) {
      next.rotation = ((integer(edit.rotation) % 360) + 360) % 360;
    }
    if (edit.seatCount !== undefined) {
      next.seatCount = clamp(
        integer(edit.seatCount),
        0,
        FLOOR_PLAN_LIMITS.maxSeats
      );
    }
    if (edit.shape !== undefined && isSquareShape(edit.shape)) {
      next = { ...next, height: next.width };
      next.x = clamp(next.x, 0, FLOOR_PLAN_LIMITS.canvasWidth - next.width);
      next.y = clamp(next.y, 0, FLOOR_PLAN_LIMITS.canvasHeight - next.height);
    }
    return next;
  });
}

function withoutTable(plan: FloorPlanDraft, tableId: string): FloorPlanDraft {
  return {
    ...plan,
    groups: plan.groups
      .map((group) => ({
        ...group,
        tableIds: group.tableIds.filter((id) => id !== tableId)
      }))
      .filter(
        (group) => group.tableIds.length >= FLOOR_PLAN_LIMITS.groupMinTables
      ),
    tables: plan.tables.filter(({ id }) => id !== tableId)
  };
}

export function removeTable(
  plan: FloorPlanDraft,
  tableId: string
): FloorPlanDraft {
  return plan.tables.some(({ id }) => id === tableId)
    ? withoutTable(plan, tableId)
    : plan;
}

/**
 * Grouping only records temporary membership: table ids, labels and geometry
 * stay exactly as they were.
 */
export function groupTables(
  plan: FloorPlanDraft,
  tableIds: string[],
  groupId: string,
  name: string
): FloorPlanDraft {
  const unique = [...new Set(tableIds)];
  const grouped = new Set(plan.groups.flatMap((group) => group.tableIds));
  const trimmed = name.trim().slice(0, 60);
  if (
    !trimmed ||
    unique.length < FLOOR_PLAN_LIMITS.groupMinTables ||
    unique.length > FLOOR_PLAN_LIMITS.groupMaxTables ||
    plan.groups.length >= FLOOR_PLAN_LIMITS.maxGroups ||
    unique.some(
      (id) => grouped.has(id) || !plan.tables.some((table) => table.id === id)
    )
  ) {
    return plan;
  }
  return {
    ...plan,
    groups: [...plan.groups, { id: groupId, name: trimmed, tableIds: unique }]
  };
}

export function ungroupTables(
  plan: FloorPlanDraft,
  groupId: string
): FloorPlanDraft {
  return {
    ...plan,
    groups: plan.groups.filter(({ id }) => id !== groupId)
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planIsDirty(
  current: FloorPlanDraft,
  saved: FloorPlanDraft
): boolean {
  return canonical(current) !== canonical(saved);
}

/** Seat centres relative to the table centre, before the table rotation. */
export function seatPositions(
  table: Pick<
    FloorTable,
    "height" | "seatCount" | "seatLayout" | "shape" | "width"
  >
): { x: number; y: number }[] {
  const count = table.seatCount;
  if (count <= 0) return [];
  const halfWidth = table.width / 2;
  const halfHeight = table.height / 2;
  const topY = -(halfHeight + SEAT_GAP);
  const bottomY = halfHeight + SEAT_GAP;

  const along = (total: number, y: number) =>
    Array.from({ length: total }, (_, index) => ({
      x: -halfWidth + ((index + 0.5) * table.width) / total,
      y
    }));

  if (table.seatLayout === "one-side") return along(count, topY);
  if (table.seatLayout === "long-sides") {
    return [
      ...along(Math.ceil(count / 2), topY),
      ...along(Math.floor(count / 2), bottomY)
    ];
  }
  if (table.shape === "round") {
    const radius = halfWidth + SEAT_GAP;
    return Array.from({ length: count }, (_, index) => {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
  }
  const boxWidth = halfWidth + SEAT_GAP;
  const boxHeight = halfHeight + SEAT_GAP;
  const perimeter = 4 * (boxWidth + boxHeight);
  return Array.from({ length: count }, (_, index) => {
    let distance = ((index + 0.5) / count) * perimeter;
    const topLength = 2 * boxWidth;
    const sideLength = 2 * boxHeight;
    if (distance < topLength) return { x: -boxWidth + distance, y: -boxHeight };
    distance -= topLength;
    if (distance < sideLength) return { x: boxWidth, y: -boxHeight + distance };
    distance -= sideLength;
    if (distance < topLength) return { x: boxWidth - distance, y: boxHeight };
    distance -= topLength;
    return { x: -boxWidth, y: boxHeight - distance };
  });
}

export function tableLabelForIssue(
  plan: FloorPlanDraft,
  path: string
): string | null {
  const match = /^(?:plan\.)?tables\[(\d+)\]/u.exec(path);
  if (!match) return null;
  return plan.tables[Number(match[1])]?.label ?? null;
}

export const SEAT_LAYOUT_LABELS: Record<FloorSeatLayout, string> = {
  "long-sides": "Lados largos",
  "one-side": "Un solo lado",
  perimeter: "Alrededor"
};

export const SHAPE_LABELS: Record<FloorTableShape, string> = {
  rectangle: "Rectangular",
  round: "Redonda",
  square: "Cuadrada"
};
