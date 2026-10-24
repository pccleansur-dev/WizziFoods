import {
  FLOOR_PLAN_LIMITS,
  type FloorLevel,
  type FloorPlanDraft,
  type FloorSeatLayout,
  type FloorTable,
  type FloorTableShape
} from "@platform/contracts";

const SEAT_GAP = 18;
const GRID_STEP = 180;
const GRID_ORIGIN = 40;

export function createEmptyFloorPlan(): FloorPlanDraft {
  return { floors: [], groups: [], sectors: [], tables: [] };
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

function cleanShortName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "")
    .trim()
    .slice(0, FLOOR_PLAN_LIMITS.maxShortNameLength);
  return trimmed ? trimmed : null;
}

function floorNameTaken(plan: FloorPlanDraft, name: string): boolean {
  const wanted = name.toLocaleLowerCase("es");
  return plan.floors.some(
    (floor) => floor.name.toLocaleLowerCase("es") === wanted
  );
}

/** Un local siempre tiene al menos una planta: se crea «Planta baja» si no hay ninguna. */
export function ensureDefaultFloor(
  plan: FloorPlanDraft,
  id: string
): FloorPlanDraft {
  return plan.floors.length > 0
    ? plan
    : {
        ...plan,
        floors: [{ id, name: "Planta baja", position: 0, shortName: null }]
      };
}

export function addFloor(
  plan: FloorPlanDraft,
  name: string,
  id: string,
  shortName?: string | null
): FloorPlanDraft {
  const trimmed = name.trim().slice(0, 60);
  if (
    !trimmed ||
    plan.floors.length >= FLOOR_PLAN_LIMITS.maxFloors ||
    floorNameTaken(plan, trimmed)
  ) {
    return plan;
  }
  const floor: FloorLevel = {
    id,
    name: trimmed,
    position: plan.floors.length,
    shortName: cleanShortName(shortName)
  };
  return { ...plan, floors: [...plan.floors, floor] };
}

export function renameFloor(
  plan: FloorPlanDraft,
  floorId: string,
  name: string,
  shortName?: string | null
): FloorPlanDraft {
  return {
    ...plan,
    floors: plan.floors.map((floor) =>
      floor.id === floorId
        ? {
            ...floor,
            name: name.slice(0, 60),
            shortName: cleanShortName(shortName)
          }
        : floor
    )
  };
}

/** Una planta solo se quita vacía, y siempre queda al menos una. */
export function removeFloor(
  plan: FloorPlanDraft,
  floorId: string
): FloorPlanDraft {
  if (
    plan.floors.length <= 1 ||
    plan.tables.some((table) => table.floorId === floorId)
  ) {
    return plan;
  }
  return {
    ...plan,
    floors: plan.floors
      .filter((floor) => floor.id !== floorId)
      .map((floor, position) => ({ ...floor, position }))
  };
}

/** Lo que muestra el lienzo: las mesas y agrupaciones de una sola planta. */
export function planForFloor(
  plan: FloorPlanDraft,
  floorId: string
): FloorPlanDraft {
  const tables = plan.tables.filter((table) => table.floorId === floorId);
  const ids = new Set(tables.map(({ id }) => id));
  return {
    ...plan,
    groups: plan.groups.filter((group) =>
      group.tableIds.every((id) => ids.has(id))
    ),
    tables
  };
}

function withoutTableFromGroups(
  plan: FloorPlanDraft,
  tableId: string
): FloorPlanDraft {
  return {
    ...plan,
    groups: plan.groups
      .map((group) => ({
        ...group,
        tableIds: group.tableIds.filter((id) => id !== tableId)
      }))
      .filter(
        (group) => group.tableIds.length >= FLOOR_PLAN_LIMITS.groupMinTables
      )
  };
}

/**
 * Pasa una mesa a otra planta sin cambiar su identidad ni su QR. Sale de su
 * agrupación (que no puede cruzar plantas) y busca un lugar libre en la nueva.
 */
export function moveTableToFloor(
  plan: FloorPlanDraft,
  tableId: string,
  floorId: string
): FloorPlanDraft {
  const table = plan.tables.find(({ id }) => id === tableId);
  if (
    !table ||
    table.floorId === floorId ||
    !plan.floors.some(({ id }) => id === floorId)
  ) {
    return plan;
  }
  const target = planForFloor(
    { ...plan, tables: plan.tables.filter(({ id }) => id !== tableId) },
    floorId
  );
  const spot = overlaps(target, table.x, table.y, table.width, table.height)
    ? freeSpot(target, table.width, table.height)
    : { x: table.x, y: table.y };
  const withoutGroup = withoutTableFromGroups(plan, tableId);
  return {
    ...withoutGroup,
    tables: withoutGroup.tables.map((item) =>
      item.id === tableId
        ? fitInsideCanvas({ ...item, floorId, ...spot })
        : item
    )
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
  input: {
    floorId: string;
    id: string;
    sectorId: string;
    shape: FloorTableShape;
  }
): FloorPlanDraft {
  if (
    plan.tables.length >= FLOOR_PLAN_LIMITS.maxTables ||
    !plan.sectors.some(({ id }) => id === input.sectorId) ||
    !plan.floors.some(({ id }) => id === input.floorId)
  ) {
    return plan;
  }
  const rectangle = input.shape === "rectangle";
  const width = rectangle ? 160 : 100;
  const height = rectangle ? 90 : 100;
  const table: FloorTable = {
    floorId: input.floorId,
    height,
    id: input.id,
    label: nextLabel(plan),
    rotation: 0,
    seatCount: rectangle ? 6 : 4,
    seatLayout: rectangle ? "long-sides" : "perimeter",
    sectorId: input.sectorId,
    shape: input.shape,
    width,
    ...freeSpot(planForFloor(plan, input.floorId), width, height)
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
  return mapTable(plan, tableId, (table) =>
    fitInsideCanvas({ ...table, x: integer(x), y: integer(y) })
  );
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
    return fitInsideCanvas({
      ...table,
      height: nextHeight,
      width: nextWidth
    });
  });
}

/**
 * Mantiene la mesa dentro del lienzo teniendo en cuenta su giro: el contrato
 * valida la caja sin girar, y a la vista la mesa girada no debe sobresalir.
 * Conserva el centro siempre que sea posible.
 */
export function fitInsideCanvas(table: FloorTable): FloorTable {
  const radians = (table.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfWidth = table.width / 2;
  const halfHeight = table.height / 2;
  const needX = Math.max(halfWidth, cos * halfWidth + sin * halfHeight);
  const needY = Math.max(halfHeight, sin * halfWidth + cos * halfHeight);
  const centerX = clamp(
    table.x + halfWidth,
    needX,
    FLOOR_PLAN_LIMITS.canvasWidth - needX
  );
  const centerY = clamp(
    table.y + halfHeight,
    needY,
    FLOOR_PLAN_LIMITS.canvasHeight - needY
  );
  return {
    ...table,
    x: clamp(
      Math.round(centerX - halfWidth),
      0,
      FLOOR_PLAN_LIMITS.canvasWidth - table.width
    ),
    y: clamp(
      Math.round(centerY - halfHeight),
      0,
      FLOOR_PLAN_LIMITS.canvasHeight - table.height
    )
  };
}

export const ZOOM_LIMITS = { max: 4, min: 0.1 } as const;

const ZOOM_LEVELS = [
  0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4
] as const;

/** Zoom del plano entre 10% y 400%, con dos decimales. */
export function clampZoom(value: number): number {
  return Math.round(clamp(value, ZOOM_LIMITS.min, ZOOM_LIMITS.max) * 100) / 100;
}

/** Un paso de los botones: va al siguiente nivel (…25%, 30%, 40%, 50%, 75%, 100%, 125%…). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_LEVELS.find((level) => level > zoom + 0.001) ?? ZOOM_LIMITS.max;
  }
  return (
    [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 0.001) ??
    ZOOM_LIMITS.min
  );
}

/** Zoom con la rueda (o el gesto de pellizco del trackpad), más fino que los botones. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * 0.0015));
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
    }
    return fitInsideCanvas(next);
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
    ) ||
    new Set(
      unique.map((id) => plan.tables.find((table) => table.id === id)?.floorId)
    ).size > 1
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
  // Mesa rectangular o cuadrada: se reparte por lados según la forma.
  const sides = perimeterSideCounts(count, table.width, table.height);
  const sideX = halfWidth + SEAT_GAP;
  const alongHeight = (total: number, x: number) =>
    Array.from({ length: total }, (_, index) => ({
      x,
      y: -halfHeight + ((index + 0.5) * table.height) / total
    }));
  return [
    ...along(sides.top, topY),
    ...alongHeight(sides.right, sideX),
    ...along(sides.bottom, bottomY),
    ...alongHeight(sides.left, -sideX)
  ];
}

type SeatedTable = Pick<
  FloorTable,
  | "height"
  | "rotation"
  | "seatCount"
  | "seatLayout"
  | "shape"
  | "width"
  | "x"
  | "y"
>;
type Side = "bottom" | "left" | "right" | "top";

/** A local point (relative to the table centre, before rotating) in plan coordinates. */
function toPlan(table: SeatedTable, point: { x: number; y: number }) {
  const radians = (table.rotation * Math.PI) / 180;
  return {
    x:
      table.x +
      table.width / 2 +
      point.x * Math.cos(radians) -
      point.y * Math.sin(radians),
    y:
      table.y +
      table.height / 2 +
      point.x * Math.sin(radians) +
      point.y * Math.cos(radians)
  };
}

/** Whether a plan point is inside the table, grown by two seat gaps on every side. */
function insideZone(table: SeatedTable, point: { x: number; y: number }) {
  const radians = (table.rotation * Math.PI) / 180;
  const dx = point.x - (table.x + table.width / 2);
  const dy = point.y - (table.y + table.height / 2);
  const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
  const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
  return (
    Math.abs(localX) < table.width / 2 + SEAT_GAP * 2 &&
    Math.abs(localY) < table.height / 2 + SEAT_GAP * 2
  );
}

function sideSeats(table: SeatedTable, side: Side, total: number) {
  const halfWidth = table.width / 2;
  const halfHeight = table.height / 2;
  return Array.from({ length: total }, (_, index) => {
    const alongX = -halfWidth + ((index + 0.5) * table.width) / total;
    const alongY = -halfHeight + ((index + 0.5) * table.height) / total;
    if (side === "top") return { x: alongX, y: -(halfHeight + SEAT_GAP) };
    if (side === "bottom") return { x: alongX, y: halfHeight + SEAT_GAP };
    if (side === "left") return { x: -(halfWidth + SEAT_GAP), y: alongY };
    return { x: halfWidth + SEAT_GAP, y: alongY };
  });
}

/**
 * Seats of a table that belongs to a group: the sides that face another table
 * of the group are left empty and their seats go to the free sides, so the
 * total stays the same and nobody sits between two joined tables.
 */
export function seatPositionsWithin(
  table: SeatedTable,
  neighbours: SeatedTable[]
): { x: number; y: number }[] {
  const base = seatPositions(table);
  if (neighbours.length === 0 || base.length === 0) return base;
  const faces = (point: { x: number; y: number }) =>
    neighbours.some((other) => insideZone(other, toPlan(table, point)));

  if (table.shape === "round") {
    return base.filter((seat) => !faces(seat));
  }

  const halfWidth = table.width / 2;
  const halfHeight = table.height / 2;
  const probes: Record<Side, { x: number; y: number }[]> = {
    bottom: [-halfWidth, 0, halfWidth].map((x) => ({
      x,
      y: halfHeight + SEAT_GAP
    })),
    left: [-halfHeight, 0, halfHeight].map((y) => ({
      x: -(halfWidth + SEAT_GAP),
      y
    })),
    right: [-halfHeight, 0, halfHeight].map((y) => ({
      x: halfWidth + SEAT_GAP,
      y
    })),
    top: [-halfWidth, 0, halfWidth].map((x) => ({
      x,
      y: -(halfHeight + SEAT_GAP)
    }))
  };
  const allowed: Side[] =
    table.seatLayout === "one-side"
      ? ["top"]
      : table.seatLayout === "long-sides"
        ? ["top", "bottom"]
        : ["top", "right", "bottom", "left"];
  const free = allowed.filter((side) => !probes[side].some(faces));
  if (free.length === allowed.length)
    return base.filter((seat) => !faces(seat));
  if (free.length === 0) return base.filter((seat) => !faces(seat));

  const length = (side: Side) =>
    side === "top" || side === "bottom" ? table.width : table.height;
  const total = table.seatCount;
  const weight = free.reduce((sum, side) => sum + length(side), 0);
  const counts = new Map<Side, number>(
    free.map((side) => [side, Math.floor((total * length(side)) / weight)])
  );
  let missing = total - [...counts.values()].reduce((a, b) => a + b, 0);
  // A igual resto, el sobrante va a los lados de arriba y de abajo.
  const preferred = (side: Side) =>
    side === "top" || side === "bottom" ? 0 : 1;
  const byRemainder = [...free].sort(
    (left, right) =>
      (((total * length(right)) / weight) % 1) -
        (((total * length(left)) / weight) % 1) ||
      preferred(left) - preferred(right)
  );
  for (let index = 0; missing > 0; index = (index + 1) % byRemainder.length) {
    const side = byRemainder[index] as Side;
    counts.set(side, (counts.get(side) ?? 0) + 1);
    missing -= 1;
  }
  return free
    .flatMap((side) => sideSeats(table, side, counts.get(side) ?? 0))
    .filter((seat) => !faces(seat));
}

/**
 * Cuántas sillas van en cada lado cuando la disposición es «alrededor». En una
 * mesa alargada va una silla en cada extremo y el resto en los lados largos
 * (8 sillas: 3-1-3-1); en una cuadrada se reparten parejo (8 sillas: 2-2-2-2).
 */
export function perimeterSideCounts(
  count: number,
  width: number,
  height: number
): { bottom: number; left: number; right: number; top: number } {
  const longer = Math.max(width, height);
  const shorter = Math.max(1, Math.min(width, height));
  if (longer / shorter < 1.25) {
    const base = Math.floor(count / 4);
    const extra = count - base * 4;
    return {
      bottom: base + (extra > 1 ? 1 : 0),
      left: base + (extra > 3 ? 1 : 0),
      right: base + (extra > 2 ? 1 : 0),
      top: base + (extra > 0 ? 1 : 0)
    };
  }
  const ends = count >= 4 ? 1 : 0;
  const rest = count - 2 * ends;
  const first = Math.ceil(rest / 2);
  const second = rest - first;
  return width >= height
    ? { bottom: second, left: ends, right: ends, top: first }
    : { bottom: ends, left: second, right: first, top: ends };
}

/** Gira la mesa en pasos (por ejemplo 90°) y vuelve a 0° al completar la vuelta. */
export function rotateTable(
  plan: FloorPlanDraft,
  tableId: string,
  degrees: number
): FloorPlanDraft {
  const current = plan.tables.find(({ id }) => id === tableId)?.rotation ?? 0;
  return updateTable(plan, tableId, { rotation: current + degrees });
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

export type QrEntry = { saved: boolean; table: FloorTable };

/**
 * Las mesas del listado de QR agrupadas por planta, en el orden de las plantas.
 * Una mesa quitada que ya estaba guardada sigue apareciendo (su QR vive hasta el
 * próximo guardado) en la planta en la que estaba. Las plantas sin mesas no salen.
 */
export function qrEntriesByFloor(
  plan: FloorPlanDraft,
  savedPlan: FloorPlanDraft
): { entries: QrEntry[]; floor: FloorLevel }[] {
  const savedIds = new Set(savedPlan.tables.map(({ id }) => id));
  const current = new Map(plan.tables.map((table) => [table.id, table]));
  const floors = new Map(
    [...savedPlan.floors, ...plan.floors].map((floor) => [floor.id, floor])
  );
  const entries: QrEntry[] = [
    ...savedPlan.tables.map((table) => ({
      saved: true,
      table: current.get(table.id) ?? table
    })),
    ...plan.tables
      .filter((table) => !savedIds.has(table.id))
      .map((table) => ({ saved: false, table }))
  ];
  const planOrder = new Map(
    [...plan.floors, ...savedPlan.floors].map((floor, index) => [
      floor.id,
      index
    ])
  );
  const grouped = new Map<string, QrEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.table.floorId) ?? [];
    list.push(entry);
    grouped.set(entry.table.floorId, list);
  }
  return [...grouped.entries()]
    .flatMap(([floorId, list]) => {
      const floor = floors.get(floorId);
      return floor ? [{ entries: list, floor }] : [];
    })
    .sort(
      (left, right) =>
        left.floor.position - right.floor.position ||
        (planOrder.get(left.floor.id) ?? 0) -
          (planOrder.get(right.floor.id) ?? 0)
    );
}

/** The group a table is in and the labels of the other tables whose QR leads to the same party. */
export function groupOfTable(
  plan: FloorPlanDraft,
  tableId: string
): { name: string; withLabels: string[] } | null {
  const group = plan.groups.find(({ tableIds }) => tableIds.includes(tableId));
  if (!group) return null;
  const labels = new Map(plan.tables.map(({ id, label }) => [id, label]));
  return {
    name: group.name,
    withLabels: group.tableIds
      .filter((id) => id !== tableId)
      .flatMap((id) => labels.get(id) ?? [])
  };
}
