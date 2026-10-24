import {
  parseReadinessView,
  type ReadinessReport,
  type SandboxRun
} from "@platform/contracts";

import { adminApi, dataOf } from "../admin-api";

export type ReadinessCommand = "cleanup" | "publish" | "simulate";

export type ReadinessActionState = {
  message: string;
  readiness: ReadinessReport | null;
  run: SandboxRun | null;
  status: "error" | "idle" | "invalid" | "saved";
};

export function parseReadiness(body: unknown): ReadinessReport {
  const report = parseReadinessView(dataOf(body));
  if (!report) throw new Error("Respuesta de requisitos inválida.");
  return report;
}

export async function loadReadiness(): Promise<
  { readiness: ReadinessReport; status: "ready" } | { status: "unavailable" }
> {
  try {
    const result = await adminApi("/v1/tenant/readiness");
    if (!result.ok) return { status: "unavailable" };
    return { readiness: parseReadiness(result.body), status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}
