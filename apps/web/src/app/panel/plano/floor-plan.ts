import { readWebConfig } from "@platform/config";
import {
  parseFloorPlanDraft,
  type FloorPlanDraft,
  type FloorPlanIssue
} from "@platform/contracts";

import { createAuthServerClient } from "../../../auth/supabase-server";

export type FloorPlanQr = {
  label: string;
  svg: string;
  tableId: string;
  url: string;
};

export type SavedFloorPlan = {
  plan: FloorPlanDraft;
  version: number;
};

export type FloorPlanActionState = {
  issues: FloorPlanIssue[];
  message: string;
  plan: FloorPlanDraft | null;
  qr: FloorPlanQr[] | null;
  status: "conflict" | "error" | "idle" | "invalid" | "replayed" | "saved";
  version: number | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function invalid(): never {
  throw new Error("Respuesta del plano inválida.");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSaved(value: unknown): SavedFloorPlan {
  const root = record(value);
  const parsed = root ? parseFloorPlanDraft(root.plan) : null;
  if (
    !root ||
    !parsed?.ok ||
    !Number.isSafeInteger(root.version) ||
    (root.version as number) < 0
  ) {
    return invalid();
  }
  return { plan: parsed.plan, version: root.version as number };
}

export function parseFloorPlanResponse(input: unknown): SavedFloorPlan {
  const root = record(input);
  if (!root || Object.keys(root).join() !== "data") return invalid();
  return parseSaved(root.data);
}

export function parseFloorPlanSaveResponse(
  input: unknown
): SavedFloorPlan & { applied: boolean } {
  const root = record(input);
  const data = root ? record(root.data) : null;
  if (
    !root ||
    Object.keys(root).join() !== "data" ||
    !data ||
    Object.keys(data).sort().join() !== "applied,plan,version" ||
    typeof data.applied !== "boolean"
  ) {
    return invalid();
  }
  return { ...parseSaved(data), applied: data.applied };
}

export function parseFloorPlanQrResponse(input: unknown): FloorPlanQr[] {
  const root = record(input);
  if (
    !root ||
    Object.keys(root).join() !== "data" ||
    !Array.isArray(root.data)
  ) {
    return invalid();
  }
  return root.data.map((value) => {
    const item = record(value);
    if (
      !item ||
      Object.keys(item).sort().join() !== "label,svg,tableId,url" ||
      typeof item.label !== "string" ||
      typeof item.svg !== "string" ||
      !item.svg.startsWith("<svg") ||
      typeof item.tableId !== "string" ||
      !uuidPattern.test(item.tableId) ||
      typeof item.url !== "string"
    ) {
      return invalid();
    }
    return {
      label: item.label,
      svg: item.svg,
      tableId: item.tableId,
      url: item.url
    };
  });
}

export async function loadFloorPlan(
  host: string
): Promise<
  | { data: SavedFloorPlan & { qr: FloorPlanQr[] }; status: "ready" }
  | { status: "unavailable" }
> {
  const supabase = await createAuthServerClient();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken || !host) return { status: "unavailable" };
  try {
    const config = readWebConfig(process.env);
    const init = {
      cache: "no-store" as const,
      headers: { authorization: `Bearer ${accessToken}`, host }
    };
    const [planResponse, qrResponse] = await Promise.all([
      fetch(`${config.apiUrl}/v1/tenant/floor-plan`, init),
      fetch(`${config.apiUrl}/v1/tenant/floor-plan/qr`, init)
    ]);
    if (!planResponse.ok || !qrResponse.ok) return { status: "unavailable" };
    return {
      data: {
        ...parseFloorPlanResponse(await planResponse.json()),
        qr: parseFloorPlanQrResponse(await qrResponse.json())
      },
      status: "ready"
    };
  } catch {
    return { status: "unavailable" };
  }
}
