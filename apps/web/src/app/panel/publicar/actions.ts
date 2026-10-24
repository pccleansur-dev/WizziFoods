"use server";

import { parseReadinessView, parseSandboxRun } from "@platform/contracts";

import { adminApi, dataOf } from "../admin-api";
import {
  parseReadiness,
  type ReadinessActionState,
  type ReadinessCommand
} from "./readiness";

const state = (
  status: ReadinessActionState["status"],
  message: string,
  extra: Partial<Pick<ReadinessActionState, "readiness" | "run">> = {}
): ReadinessActionState => ({
  message,
  readiness: extra.readiness ?? null,
  run: extra.run ?? null,
  status
});

const sessionExpired = "La sesión venció. Volvé a ingresar.";
const unreachable =
  "No pudimos comunicarnos con la plataforma. Intentá nuevamente.";

/**
 * Los comandos no envían datos: el negocio y la ubicación los resuelve la API
 * desde la sesión y el dominio. Publicar es un comando aparte de guardar.
 */
export async function readinessCommandAction(
  command: ReadinessCommand
): Promise<ReadinessActionState> {
  try {
    switch (command) {
      case "publish": {
        const result = await adminApi("/v1/tenant/publication", {
          body: {},
          method: "POST"
        });
        if (result.ok) {
          return state("saved", "El negocio quedó publicado.", {
            readiness: parseReadiness(result.body)
          });
        }
        if (result.status === 401) return state("error", sessionExpired);
        return state(
          result.status === 409 ? "invalid" : "error",
          result.message ?? "No pudimos publicar el negocio.",
          { readiness: parseReadinessView(result.readiness) }
        );
      }
      case "simulate": {
        const result = await adminApi("/v1/tenant/sandbox/runs", {
          body: {},
          method: "POST"
        });
        if (result.ok) {
          const run = parseSandboxRun(dataOf(result.body));
          if (!run) return state("error", "Respuesta de simulación inválida.");
          return state(
            "saved",
            "La simulación terminó y se limpiaron los datos de prueba.",
            { run }
          );
        }
        if (result.status === 401) return state("error", sessionExpired);
        return state(
          result.status === 422 ? "invalid" : "error",
          result.message ?? "No pudimos simular el pedido."
        );
      }
      case "cleanup": {
        const result = await adminApi("/v1/tenant/sandbox", {
          method: "DELETE"
        });
        if (!result.ok) {
          return state(
            "error",
            result.status === 401
              ? sessionExpired
              : (result.message ?? "No pudimos limpiar los datos de prueba.")
          );
        }
        const data = dataOf(result.body) as { removed?: unknown } | undefined;
        const removed = typeof data?.removed === "number" ? data.removed : 0;
        return state("saved", `Se eliminaron ${removed} pedidos simulados.`);
      }
      default:
        return state("error", "La acción no es válida.");
    }
  } catch {
    return state("error", unreachable);
  }
}
