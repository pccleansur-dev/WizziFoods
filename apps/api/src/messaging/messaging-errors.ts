import {
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";

function databaseCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

const conflicts: Record<string, [string, string]> = {
  PT293: [
    "WHATSAPP_NOT_CONNECTED",
    "Primero conectá el número de WhatsApp del restaurante."
  ],
  PT294: [
    "WHATSAPP_NUMBER_IN_USE",
    "Ese número ya está conectado a otro restaurante."
  ],
  PT295: [
    "TEMPLATE_NOT_APPROVED",
    "Esa plantilla no existe o todavía no está aprobada por Meta."
  ],
  PT296: [
    "AUTOMATION_INVALID",
    "Esa automatización no admite esa operación en su estado actual."
  ],
  PT297: ["MESSAGING_INVALID", "Revisá los datos."]
};

/** Staff side: never echoes database detail. */
export function mapMessagingFailure(error: unknown): never {
  const code = databaseCode(error);
  if (code === "PT200") {
    throw new ForbiddenException({
      error: {
        code: "STAFF_FORBIDDEN",
        message: "No tenés permiso para operar acá."
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
  if (code === "PT298") {
    throw new NotFoundException({
      error: {
        code: "ONE_OFF_EVENT_NOT_FOUND",
        message: "No encontramos ese evento."
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
