"use server";

import { revalidatePath } from "next/cache";
import {
  isTeamUuid,
  parseTeamMemberActivation,
  parseTeamMemberCreate,
  parseTeamMemberUpdate,
  parseTeamPinReset,
  type TeamIssue,
  type TeamParseResult
} from "@platform/contracts";

import { adminApi } from "../admin-api";
import { parseTeamList, type TeamActionState, type TeamCommand } from "./team";

const state = (
  status: TeamActionState["status"],
  message: string,
  extra: Partial<TeamActionState> = {}
): TeamActionState => ({
  issues: [],
  members: null,
  message,
  status,
  ...extra
});

function invalid<T>(result: TeamParseResult<T>): TeamActionState | null {
  return result.ok
    ? null
    : state("invalid", "Revisá los datos marcados.", {
        issues: result.issues satisfies TeamIssue[]
      });
}

/**
 * One entry point for every team change. The command is validated again here,
 * the API validates it a third time, and the database a fourth. A PIN only
 * travels forward to the API: it is never part of what this action returns.
 */
export async function teamCommandAction(
  command: TeamCommand
): Promise<TeamActionState> {
  let path = "/v1/tenant/team";
  let method: "PATCH" | "POST" | "PUT" = "POST";
  let body: unknown;
  let success = "Cambios guardados.";

  switch (command?.type) {
    case "create": {
      const input = {
        displayName: command.displayName,
        pin: command.pin,
        role: command.role,
        sectorIds: command.sectorIds,
        username: command.username
      };
      const failed = invalid(parseTeamMemberCreate(input));
      if (failed) return failed;
      body = input;
      success = "Empleado creado.";
      break;
    }
    case "update": {
      const input = {
        displayName: command.displayName,
        role: command.role,
        sectorIds: command.sectorIds
      };
      const failed = invalid(parseTeamMemberUpdate(input));
      if (failed) return failed;
      if (!isTeamUuid(command.id)) return state("error", "Empleado inválido.");
      path = `/v1/tenant/team/${command.id}`;
      method = "PATCH";
      body = input;
      break;
    }
    case "active": {
      const failed = invalid(
        parseTeamMemberActivation({ active: command.active })
      );
      if (failed) return failed;
      if (!isTeamUuid(command.id)) return state("error", "Empleado inválido.");
      path = `/v1/tenant/team/${command.id}/active`;
      method = "PUT";
      body = { active: command.active };
      success = command.active
        ? "Empleado reactivado."
        : "Empleado desactivado.";
      break;
    }
    case "pin": {
      const failed = invalid(parseTeamPinReset({ pin: command.pin }));
      if (failed) return failed;
      if (!isTeamUuid(command.id)) return state("error", "Empleado inválido.");
      path = `/v1/tenant/team/${command.id}/pin`;
      method = "PUT";
      body = { pin: command.pin };
      success =
        "PIN restablecido. Las sesiones abiertas del empleado se cerraron.";
      break;
    }
    default:
      return state("error", "La acción no es válida.");
  }

  try {
    const result = await adminApi(path, { body, method });
    if (!result.ok) {
      if (result.status === 401) {
        return state("error", "La sesión venció. Volvé a ingresar.");
      }
      return state(
        result.status === 400 || result.status === 422 ? "invalid" : "error",
        result.message ?? "No pudimos guardar los cambios. Intentá nuevamente."
      );
    }
    revalidatePath("/panel", "layout");
    const list = await adminApi("/v1/tenant/team");
    return state("saved", success, {
      members: list.ok ? parseTeamList(list.body) : null
    });
  } catch {
    return state(
      "error",
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }
}
