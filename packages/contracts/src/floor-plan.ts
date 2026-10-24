export type FloorTableShape = "rectangle" | "round" | "square";
export type FloorSeatLayout = "long-sides" | "one-side" | "perimeter";

/** Una planta (piso) del local. Las mesas pertenecen a una planta y a un sector. */
export type FloorLevel = {
  id: string;
  name: string;
  position: number;
  /** Nombre corto opcional, por ejemplo «PB» o «PA». */
  shortName: string | null;
};

export type FloorSector = {
  id: string;
  name: string;
  position: number;
};

/**
 * A physical table: identity (`id`, `label`, `sectorId`) lives apart from its
 * geometry, and group membership lives apart from both.
 */
export type FloorTable = {
  floorId: string;
  height: number;
  id: string;
  label: string;
  rotation: number;
  seatCount: number;
  seatLayout: FloorSeatLayout;
  sectorId: string;
  shape: FloorTableShape;
  width: number;
  x: number;
  y: number;
};

export type FloorTableGroup = {
  id: string;
  name: string;
  tableIds: string[];
};

export type FloorPlanDraft = {
  floors: FloorLevel[];
  groups: FloorTableGroup[];
  sectors: FloorSector[];
  tables: FloorTable[];
};

export type FloorPlanCommand = {
  commandId: string;
  expectedVersion: number;
  plan: FloorPlanDraft;
};

export type FloorPlanIssueCode =
  | "DUPLICATE_ID"
  | "DUPLICATE_LABEL"
  | "INVALID_DIMENSIONS"
  | "INVALID_FIELD"
  | "INVALID_GROUP"
  | "INVALID_STRUCTURE"
  | "LIMIT_EXCEEDED"
  | "MIXED_FLOORS"
  | "OUT_OF_BOUNDS"
  | "UNKNOWN_FLOOR"
  | "UNKNOWN_SECTOR";

export type FloorPlanIssue = {
  code: FloorPlanIssueCode;
  message: string;
  path: string;
};

export type FloorPlanParseResult<T> =
  { issues: FloorPlanIssue[]; ok: false } | ({ ok: true } & T);

export const FLOOR_PLAN_LIMITS = {
  canvasHeight: 3000,
  canvasWidth: 4000,
  groupMaxTables: 20,
  groupMinTables: 2,
  maxFloors: 10,
  maxGroups: 50,
  maxSectors: 20,
  maxShortNameLength: 10,
  maxSeats: 24,
  maxTables: 200,
  maxTableSize: 600,
  minTableSize: 40
} as const;

const SHAPES: readonly string[] = ["rectangle", "round", "square"];
const SEAT_LAYOUTS: readonly string[] = ["long-sides", "one-side", "perimeter"];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0")
  );
}

function integerIn(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function canonicalText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= maximum &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

class Issues {
  readonly list: FloorPlanIssue[] = [];

  add(code: FloorPlanIssueCode, path: string, message: string): void {
    this.list.push({ code, message, path });
  }

  field(path: string, message: string): void {
    this.add("INVALID_FIELD", path, message);
  }
}

function checkFloor(
  input: unknown,
  path: string,
  issues: Issues
): FloorLevel | null {
  const value = record(input);
  if (!value || !hasExactKeys(value, ["id", "name", "position", "shortName"])) {
    issues.add(
      "INVALID_STRUCTURE",
      path,
      "La planta tiene un formato inválido."
    );
    return null;
  }
  let valid = true;
  if (!uuid(value.id)) {
    issues.field(`${path}.id`, "El identificador de la planta es inválido.");
    valid = false;
  }
  if (!canonicalText(value.name, 60)) {
    issues.field(
      `${path}.name`,
      "El nombre de la planta debe tener entre 1 y 60 caracteres, sin espacios al borde."
    );
    valid = false;
  }
  if (!(
    value.shortName === null ||
    canonicalText(value.shortName, FLOOR_PLAN_LIMITS.maxShortNameLength)
  )) {
    issues.field(
      `${path}.shortName`,
      `El nombre corto debe tener entre 1 y ${FLOOR_PLAN_LIMITS.maxShortNameLength} caracteres, sin espacios al borde.`
    );
    valid = false;
  }
  if (!integerIn(value.position, 0, FLOOR_PLAN_LIMITS.maxFloors * 10)) {
    issues.field(`${path}.position`, "La posición de la planta es inválida.");
    valid = false;
  }
  return valid ? (value as FloorLevel) : null;
}

function checkSector(
  input: unknown,
  path: string,
  issues: Issues
): FloorSector | null {
  const value = record(input);
  if (!value || !hasExactKeys(value, ["id", "name", "position"])) {
    issues.add(
      "INVALID_STRUCTURE",
      path,
      "El sector tiene un formato inválido."
    );
    return null;
  }
  let valid = true;
  if (!uuid(value.id)) {
    issues.field(`${path}.id`, "El identificador del sector es inválido.");
    valid = false;
  }
  if (!canonicalText(value.name, 60)) {
    issues.field(
      `${path}.name`,
      "El nombre del sector debe tener entre 1 y 60 caracteres, sin espacios al borde."
    );
    valid = false;
  }
  if (!integerIn(value.position, 0, FLOOR_PLAN_LIMITS.maxSectors * 10)) {
    issues.field(`${path}.position`, "La posición del sector es inválida.");
    valid = false;
  }
  return valid ? (value as FloorSector) : null;
}

function checkTable(
  input: unknown,
  path: string,
  issues: Issues
): FloorTable | null {
  const value = record(input);
  if (
    !value ||
    !hasExactKeys(value, [
      "floorId",
      "height",
      "id",
      "label",
      "rotation",
      "seatCount",
      "seatLayout",
      "sectorId",
      "shape",
      "width",
      "x",
      "y"
    ])
  ) {
    issues.add("INVALID_STRUCTURE", path, "La mesa tiene un formato inválido.");
    return null;
  }
  const before = issues.list.length;
  const limits = FLOOR_PLAN_LIMITS;
  if (!uuid(value.id)) {
    issues.field(`${path}.id`, "El identificador de la mesa es inválido.");
  }
  if (!uuid(value.sectorId)) {
    issues.field(`${path}.sectorId`, "El sector de la mesa es inválido.");
  }
  if (!uuid(value.floorId)) {
    issues.field(`${path}.floorId`, "La planta de la mesa es inválida.");
  }
  if (!canonicalText(value.label, 20)) {
    issues.field(
      `${path}.label`,
      "El nombre o número de la mesa debe tener entre 1 y 20 caracteres, sin espacios al borde."
    );
  }
  if (typeof value.shape !== "string" || !SHAPES.includes(value.shape)) {
    issues.field(`${path}.shape`, "La forma de la mesa es inválida.");
  }
  if (
    typeof value.seatLayout !== "string" ||
    !SEAT_LAYOUTS.includes(value.seatLayout)
  ) {
    issues.field(`${path}.seatLayout`, "La disposición de sillas es inválida.");
  }
  if (!integerIn(value.seatCount, 0, limits.maxSeats)) {
    issues.field(
      `${path}.seatCount`,
      `La cantidad de sillas debe estar entre 0 y ${limits.maxSeats}.`
    );
  }
  if (!integerIn(value.rotation, 0, 359)) {
    issues.field(
      `${path}.rotation`,
      "La rotación debe estar entre 0 y 359 grados."
    );
  }
  for (const axis of ["x", "y"] as const) {
    const candidate = value[axis];
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) {
      issues.field(`${path}.${axis}`, "La posición debe ser un número entero.");
    } else if (candidate < 0) {
      issues.add(
        "OUT_OF_BOUNDS",
        `${path}.${axis}`,
        "La mesa debe quedar dentro del plano."
      );
    }
  }
  for (const side of ["width", "height"] as const) {
    const candidate = value[side];
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) {
      issues.field(`${path}.${side}`, "Las dimensiones deben ser enteros.");
    } else if (
      candidate < limits.minTableSize ||
      candidate > limits.maxTableSize
    ) {
      issues.add(
        "INVALID_DIMENSIONS",
        `${path}.${side}`,
        `Las dimensiones deben estar entre ${limits.minTableSize} y ${limits.maxTableSize}.`
      );
    }
  }
  if (issues.list.length > before) return null;

  const table = value as FloorTable;
  if (
    (table.shape === "round" || table.shape === "square") &&
    table.width !== table.height
  ) {
    issues.add(
      "INVALID_DIMENSIONS",
      `${path}.height`,
      "Las mesas redondas y cuadradas necesitan el mismo ancho y alto."
    );
    return null;
  }
  if (
    table.x + table.width > limits.canvasWidth ||
    table.y + table.height > limits.canvasHeight
  ) {
    issues.add(
      "OUT_OF_BOUNDS",
      `${path}.x`,
      "La mesa debe quedar dentro del plano."
    );
    return null;
  }
  return table;
}

function checkGroup(
  input: unknown,
  path: string,
  issues: Issues
): FloorTableGroup | null {
  const value = record(input);
  if (!value || !hasExactKeys(value, ["id", "name", "tableIds"])) {
    issues.add(
      "INVALID_STRUCTURE",
      path,
      "La agrupación tiene un formato inválido."
    );
    return null;
  }
  const before = issues.list.length;
  if (!uuid(value.id)) {
    issues.field(
      `${path}.id`,
      "El identificador de la agrupación es inválido."
    );
  }
  if (!canonicalText(value.name, 60)) {
    issues.field(
      `${path}.name`,
      "El nombre de la agrupación debe tener entre 1 y 60 caracteres."
    );
  }
  if (!Array.isArray(value.tableIds) || !value.tableIds.every(uuid)) {
    issues.field(
      `${path}.tableIds`,
      "Las mesas de la agrupación son inválidas."
    );
  }
  return issues.list.length > before ? null : (value as FloorTableGroup);
}

function arrayAt(
  root: Record<string, unknown>,
  key: string,
  maximum: number,
  issues: Issues
): unknown[] | null {
  const value = root[key];
  if (!Array.isArray(value)) {
    issues.add("INVALID_STRUCTURE", key, "El plano tiene un formato inválido.");
    return null;
  }
  if (value.length > maximum) {
    issues.add(
      "LIMIT_EXCEEDED",
      key,
      `El plano admite hasta ${maximum} elementos en esta lista.`
    );
    return null;
  }
  return value;
}

export function parseFloorPlanDraft(
  input: unknown
): FloorPlanParseResult<{ plan: FloorPlanDraft }> {
  const issues = new Issues();
  const root = record(input);
  if (!root || !hasExactKeys(root, ["floors", "groups", "sectors", "tables"])) {
    issues.add("INVALID_STRUCTURE", "", "El plano tiene un formato inválido.");
    return { issues: issues.list, ok: false };
  }
  const limits = FLOOR_PLAN_LIMITS;
  const rawFloors = arrayAt(root, "floors", limits.maxFloors, issues);
  const rawSectors = arrayAt(root, "sectors", limits.maxSectors, issues);
  const rawTables = arrayAt(root, "tables", limits.maxTables, issues);
  const rawGroups = arrayAt(root, "groups", limits.maxGroups, issues);
  if (!rawFloors || !rawSectors || !rawTables || !rawGroups) {
    return { issues: issues.list, ok: false };
  }

  const floors = rawFloors.map((item, index) =>
    checkFloor(item, `floors[${index}]`, issues)
  );
  const sectors = rawSectors.map((item, index) =>
    checkSector(item, `sectors[${index}]`, issues)
  );
  const tables = rawTables.map((item, index) =>
    checkTable(item, `tables[${index}]`, issues)
  );
  const groups = rawGroups.map((item, index) =>
    checkGroup(item, `groups[${index}]`, issues)
  );

  const floorIds = new Set<string>();
  const floorNames = new Set<string>();
  floors.forEach((floor, index) => {
    if (!floor) return;
    if (floorIds.has(floor.id)) {
      issues.add(
        "DUPLICATE_ID",
        `floors[${index}].id`,
        "La planta está repetida."
      );
    }
    floorIds.add(floor.id);
    const normalized = floor.name.toLocaleLowerCase("es");
    if (floorNames.has(normalized)) {
      issues.add(
        "DUPLICATE_LABEL",
        `floors[${index}].name`,
        `Ya existe una planta llamada "${floor.name}".`
      );
    }
    floorNames.add(normalized);
  });

  const sectorIds = new Set<string>();
  sectors.forEach((sector, index) => {
    if (!sector) return;
    if (sectorIds.has(sector.id)) {
      issues.add(
        "DUPLICATE_ID",
        `sectors[${index}].id`,
        "El sector está repetido."
      );
    }
    sectorIds.add(sector.id);
  });

  const tableIds = new Set<string>();
  const labels = new Set<string>();
  tables.forEach((table, index) => {
    if (!table) return;
    if (tableIds.has(table.id)) {
      issues.add(
        "DUPLICATE_ID",
        `tables[${index}].id`,
        "La mesa está repetida."
      );
    }
    tableIds.add(table.id);
    const normalizedLabel = table.label.toLocaleLowerCase("es");
    if (labels.has(normalizedLabel)) {
      issues.add(
        "DUPLICATE_LABEL",
        `tables[${index}].label`,
        `Ya existe una mesa llamada "${table.label}".`
      );
    }
    labels.add(normalizedLabel);
    if (!floorIds.has(table.floorId)) {
      issues.add(
        "UNKNOWN_FLOOR",
        `tables[${index}].floorId`,
        "La mesa pertenece a una planta que no existe en el plano."
      );
    }
    if (!sectorIds.has(table.sectorId)) {
      issues.add(
        "UNKNOWN_SECTOR",
        `tables[${index}].sectorId`,
        "La mesa pertenece a un sector que no existe en el plano."
      );
    }
  });

  const knownTableIds = new Set(
    rawTables.flatMap((item) => {
      const id = record(item)?.id;
      return uuid(id) ? [id] : [];
    })
  );
  const floorOfTable = new Map<string, string>();
  for (const table of tables) {
    if (table) floorOfTable.set(table.id, table.floorId);
  }
  const groupIds = new Set<string>();
  const grouped = new Set<string>();
  groups.forEach((group, index) => {
    if (!group) return;
    const path = `groups[${index}]`;
    if (groupIds.has(group.id)) {
      issues.add("DUPLICATE_ID", `${path}.id`, "La agrupación está repetida.");
    }
    groupIds.add(group.id);
    if (
      group.tableIds.length < limits.groupMinTables ||
      group.tableIds.length > limits.groupMaxTables ||
      new Set(group.tableIds).size !== group.tableIds.length
    ) {
      issues.add(
        "INVALID_GROUP",
        `${path}.tableIds`,
        `Una agrupación necesita entre ${limits.groupMinTables} y ${limits.groupMaxTables} mesas distintas.`
      );
    }
    for (const tableId of group.tableIds) {
      if (!knownTableIds.has(tableId)) {
        issues.add(
          "INVALID_GROUP",
          `${path}.tableIds`,
          "La agrupación incluye una mesa que no existe en el plano."
        );
      } else if (grouped.has(tableId)) {
        issues.add(
          "INVALID_GROUP",
          `${path}.tableIds`,
          "Una mesa no puede pertenecer a dos agrupaciones."
        );
      }
      grouped.add(tableId);
    }
    const levels = new Set(
      group.tableIds.flatMap((tableId) => {
        const level = floorOfTable.get(tableId);
        return level ? [level] : [];
      })
    );
    if (levels.size > 1) {
      issues.add(
        "MIXED_FLOORS",
        `${path}.tableIds`,
        "Una agrupación solo puede tener mesas de la misma planta."
      );
    }
  });

  if (issues.list.length > 0) return { issues: issues.list, ok: false };
  return {
    ok: true,
    plan: {
      floors: floors as FloorLevel[],
      groups: groups as FloorTableGroup[],
      sectors: sectors as FloorSector[],
      tables: tables as FloorTable[]
    }
  };
}

export function parseFloorPlanCommand(
  input: unknown
): FloorPlanParseResult<{ command: FloorPlanCommand }> {
  const root = record(input);
  if (!root || !hasExactKeys(root, ["commandId", "expectedVersion", "plan"])) {
    return {
      issues: [
        {
          code: "INVALID_STRUCTURE",
          message: "El comando de guardado tiene un formato inválido.",
          path: ""
        }
      ],
      ok: false
    };
  }
  const issues = new Issues();
  if (!uuid(root.commandId)) {
    issues.field("commandId", "El identificador del comando es inválido.");
  }
  if (!integerIn(root.expectedVersion, 0, 2_147_483_647)) {
    issues.field("expectedVersion", "La versión esperada es inválida.");
  }
  const plan = parseFloorPlanDraft(root.plan);
  if (!plan.ok) {
    for (const issue of plan.issues) {
      issues.list.push({
        ...issue,
        path: issue.path ? `plan.${issue.path}` : "plan"
      });
    }
  }
  if (issues.list.length > 0 || !plan.ok) {
    return { issues: issues.list, ok: false };
  }
  return {
    command: {
      commandId: root.commandId as string,
      expectedVersion: root.expectedVersion as number,
      plan: plan.plan
    },
    ok: true
  };
}
