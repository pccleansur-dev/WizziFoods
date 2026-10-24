import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../panel/tenant-fetch";

export type TableEntryReason =
  "needs_cleaning" | "not_accepting" | "out_of_service";

export type TableEntry = {
  canCallWaiter: boolean;
  canConfirmOrder: boolean;
  group: { name: string; tableLabels: string[] } | null;
  mode: "join" | "start" | "view_only";
  reason: TableEntryReason | null;
  table: { floorName: string; label: string; sectorName: string };
};

export type TableEntryResult =
  | { entry: TableEntry; status: "ok" }
  | { status: "error" | "invalid" | "unavailable" | "unreachable" };

const reasons = new Set(["needs_cleaning", "not_accepting", "out_of_service"]);
const modes = new Set(["join", "start", "view_only"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Validates the API answer; anything unexpected becomes an error. */
export function parseTableEntryResponse(body: unknown): TableEntryResult {
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  if (data?.status === "invalid") return { status: "invalid" };
  if (data?.status === "unavailable") return { status: "unavailable" };
  if (data?.status !== "ok" || !isRecord(data.entry))
    return { status: "error" };
  const entry = data.entry;
  const table = isRecord(entry.table) ? entry.table : null;
  const floorName = text(table?.floorName);
  const label = text(table?.label);
  const sectorName = text(table?.sectorName);
  const group = entry.group;
  const groupName = isRecord(group) ? text(group.name) : null;
  const groupLabels =
    isRecord(group) &&
    Array.isArray(group.tableLabels) &&
    group.tableLabels.every((item) => typeof item === "string")
      ? (group.tableLabels as string[])
      : null;
  if (
    !floorName ||
    !label ||
    !sectorName ||
    typeof entry.canCallWaiter !== "boolean" ||
    typeof entry.canConfirmOrder !== "boolean" ||
    typeof entry.mode !== "string" ||
    !modes.has(entry.mode) ||
    (entry.reason !== null &&
      (typeof entry.reason !== "string" || !reasons.has(entry.reason))) ||
    (group !== null && (!groupName || !groupLabels))
  ) {
    return { status: "error" };
  }
  return {
    entry: {
      canCallWaiter: entry.canCallWaiter,
      canConfirmOrder: entry.canConfirmOrder,
      group:
        groupName && groupLabels
          ? { name: groupName, tableLabels: groupLabels }
          : null,
      mode: entry.mode as TableEntry["mode"],
      reason: entry.reason as TableEntryReason | null,
      table: { floorName, label, sectorName }
    },
    status: "ok"
  };
}

/**
 * Asks the API what this QR means. Only the token travels, in the body; the
 * tenant and location are derived by the API from the host of the request.
 */
export async function loadTableEntry(
  host: string,
  token: string
): Promise<TableEntryResult> {
  if (!host) return { status: "unreachable" };
  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(
      `${config.apiUrl}/v1/public/table-entry`,
      {
        body: JSON.stringify({ token }),
        cache: "no-store",
        headers: { "content-type": "application/json", host },
        method: "POST"
      }
    );
    // An unknown or suspended business is never told apart from a missing one.
    if (response.status === 404) return { status: "unreachable" };
    if (!response.ok) return { status: "error" };
    return parseTableEntryResponse(await response.json());
  } catch {
    return { status: "error" };
  }
}
