import {
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";

import { mapDinerFailure } from "../diner-identity/diner-errors.js";

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

const conflicts: Record<string, [string, string]> = {
  PT100: [
    "WAITER_COMMAND_REUSED",
    "Esa operación ya se usó con otros datos. Volvé a intentarlo."
  ],
  PT287: [
    "LOYALTY_DISABLED",
    "Este restaurante no tiene el programa de premios activo."
  ],
  PT288: [
    "BIRTHDAY_PROFILE_TOO_NEW",
    "Todavía no podés cargar tu cumpleaños: tu perfil es muy reciente."
  ],
  PT289: [
    "BIRTHDAY_CHANGE_LIMIT",
    "Ya cambiaste tu cumpleaños las veces permitidas."
  ],
  PT290: [
    "REWARD_UNAVAILABLE",
    "Ese premio ya no está disponible. Actualizá la pantalla."
  ],
  PT291: ["LOYALTY_INVALID", "Revisá los datos."],
  PT292: [
    "REWARD_NOT_APPLICABLE",
    "No se puede aplicar un premio a esta cuenta."
  ]
};

/** Diner side: session problems keep the diner contract, the rest are conflicts. */
export function mapLoyaltyDinerFailure(error: unknown): never {
  const code = databaseCode(error);
  const mapped = code ? conflicts[code] : undefined;
  if (mapped) {
    throw new ConflictException({
      error: { code: mapped[0], message: mapped[1] }
    });
  }
  return mapDinerFailure(error);
}

/** Staff side: never echoes database detail. */
export function mapLoyaltyStaffFailure(error: unknown): never {
  const code = databaseCode(error);
  if (code === "PT200") {
    throw new ForbiddenException({
      error: {
        code: "STAFF_FORBIDDEN",
        message: "No tenés permiso para operar esta mesa."
      }
    });
  }
  if (code === "PT201") {
    throw new NotFoundException({
      error: {
        code: "ACCOUNT_NOT_FOUND",
        message: "No encontramos eso en tu zona."
      }
    });
  }
  if (code === "PT222") {
    throw new ForbiddenException({
      error: {
        code: "MANAGER_REQUIRED",
        message: "Esta operación la hace el Encargado."
      }
    });
  }
  const mapped = code ? conflicts[code] : undefined;
  if (mapped) {
    throw new ConflictException({
      error: { code: mapped[0], message: mapped[1] }
    });
  }
  throw error;
}
