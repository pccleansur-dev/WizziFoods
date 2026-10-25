import type { WaiterTableState } from "./waiter-operations.js";

/**
 * Joining and separating tables during service. Neither request can carry a
 * tenant, a location, an amount or an order: only which tables, which group and
 * which table keeps an open account.
 */
export type JoinTablesCommand = {
  commandId: string;
  /** Names the group; when empty the server proposes "Mesas 1 + 2". */
  name: string | null;
  tableIds: string[];
};

export type SeparateTablesCommand = {
  /** The table that keeps the open account; required while there is one. */
  anchorTableId: string | null;
  commandId: string;
};

export type RegroupedTable = {
  label: string;
  state: WaiterTableState;
  tableId: string;
};

export type JoinTablesResult = {
  groupId: string;
  /** Groups that were folded into the surviving one. */
  mergedGroupIds: string[];
  name: string;
  /** The open account that follows the group, if there is one. */
  sessionId: string | null;
  tables: RegroupedTable[];
};

export type SeparateTablesResult = {
  anchorTableId: string | null;
  groupId: string;
  name: string;
  /** Tables that were only occupied by the account and are available again. */
  releasedTableIds: string[];
  sessionId: string | null;
  tables: RegroupedTable[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states: readonly WaiterTableState[] = [
  "available",
  "needs_cleaning",
  "occupied",
  "out_of_service"
];
const minimumTables = 2;
const maximumTables = 20;
const maximumNameLength = 60;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = []
) {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function uuidList(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const parsed: string[] = [];
  for (const item of input) {
    const id = uuid(item);
    if (id === null) return null;
    parsed.push(id);
  }
  return new Set(parsed).size === parsed.length ? parsed : null;
}

function groupName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 &&
    trimmed.length <= maximumNameLength &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)
    ? trimmed
    : null;
}

function regroupedTable(input: unknown): RegroupedTable | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["label", "state", "tableId"])) return null;
  const tableId = uuid(root.tableId);
  const state = states.find((candidate) => candidate === root.state);
  return tableId &&
    typeof root.label === "string" &&
    root.label.length > 0 &&
    root.label.length <= 80 &&
    state
    ? { label: root.label, state, tableId }
    : null;
}

function regroupedTables(input: unknown): RegroupedTable[] | null {
  if (!Array.isArray(input) || input.length < 1) return null;
  const parsed: RegroupedTable[] = [];
  for (const item of input) {
    const table = regroupedTable(item);
    if (table === null) return null;
    parsed.push(table);
  }
  return parsed;
}

export function parseJoinTablesCommand(
  input: unknown
): JoinTablesCommand | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["commandId", "tableIds"], ["name"])) {
    return null;
  }
  const commandId = uuid(root.commandId);
  const tableIds = uuidList(root.tableIds);
  if (
    !commandId ||
    !tableIds ||
    tableIds.length < minimumTables ||
    tableIds.length > maximumTables
  ) {
    return null;
  }
  let name: string | null = null;
  if (root.name !== undefined && root.name !== null) {
    if (typeof root.name !== "string") return null;
    if (root.name.trim() !== "") {
      name = groupName(root.name);
      if (name === null) return null;
    }
  }
  return { commandId, name, tableIds };
}

export function parseSeparateTablesCommand(
  input: unknown
): SeparateTablesCommand | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["commandId"], ["anchorTableId"])) {
    return null;
  }
  const commandId = uuid(root.commandId);
  if (!commandId) return null;
  if (root.anchorTableId === undefined || root.anchorTableId === null) {
    return { anchorTableId: null, commandId };
  }
  const anchorTableId = uuid(root.anchorTableId);
  return anchorTableId ? { anchorTableId, commandId } : null;
}

export function parseJoinTablesResult(input: unknown): JoinTablesResult | null {
  const root = record(input);
  if (
    !root ||
    !hasOnlyKeys(root, [
      "groupId",
      "mergedGroupIds",
      "name",
      "sessionId",
      "tables"
    ])
  ) {
    return null;
  }
  const groupId = uuid(root.groupId);
  const mergedGroupIds = uuidList(root.mergedGroupIds);
  const name = groupName(root.name);
  const sessionId = root.sessionId === null ? null : uuid(root.sessionId);
  const tables = regroupedTables(root.tables);
  return groupId &&
    mergedGroupIds &&
    name &&
    sessionId !== undefined &&
    (root.sessionId === null || sessionId !== null) &&
    tables &&
    tables.length >= minimumTables
    ? { groupId, mergedGroupIds, name, sessionId, tables }
    : null;
}

export function parseSeparateTablesResult(
  input: unknown
): SeparateTablesResult | null {
  const root = record(input);
  if (
    !root ||
    !hasOnlyKeys(root, [
      "anchorTableId",
      "groupId",
      "name",
      "releasedTableIds",
      "sessionId",
      "tables"
    ])
  ) {
    return null;
  }
  const groupId = uuid(root.groupId);
  const name = groupName(root.name);
  const releasedTableIds = uuidList(root.releasedTableIds);
  const anchorTableId =
    root.anchorTableId === null ? null : uuid(root.anchorTableId);
  const sessionId = root.sessionId === null ? null : uuid(root.sessionId);
  const tables = regroupedTables(root.tables);
  if (
    !groupId ||
    !name ||
    !releasedTableIds ||
    !tables ||
    (root.anchorTableId !== null && anchorTableId === null) ||
    (root.sessionId !== null && sessionId === null)
  ) {
    return null;
  }
  // An open account always stays with an anchor, and the anchor is never released.
  if (sessionId !== null && anchorTableId === null) return null;
  if (anchorTableId !== null && releasedTableIds.includes(anchorTableId)) {
    return null;
  }
  return {
    anchorTableId,
    groupId,
    name,
    releasedTableIds,
    sessionId,
    tables
  };
}
