import {
  ConflictException,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";

import {
  DinerAuthUnavailableError,
  DinerLoginInvalidError,
  DinerSessionInvalidError
} from "./diner-identity.service.js";

const messages: Record<string, [string, string]> = {
  PT282: ["DINER_PROFILE_REQUIRED", "Primero completá tu perfil."],
  PT283: [
    "CONSENT_TEXT_OUTDATED",
    "El texto cambió: leelo de nuevo antes de aceptar."
  ],
  PT284: [
    "DINER_PHONE_CONFLICT",
    "Para el consentimiento de WhatsApp hace falta un teléfono, y no se puede cambiar mientras esté aceptado."
  ],
  PT285: ["CONSENT_NOT_GRANTED", "Ese consentimiento no estaba aceptado."],
  PT286: [
    "COMMAND_REUSED",
    "Ese pedido ya se usó con otros datos. Probá de nuevo."
  ]
};

function unauthorized(code: string, message: string) {
  return new UnauthorizedException({ error: { code, message } });
}

/** Maps what the diner flow can throw to the responses the web understands. */
export function mapDinerFailure(error: unknown): never {
  if (error instanceof DinerAuthUnavailableError) {
    throw new NotFoundException({
      error: {
        code: "DINER_AUTH_UNAVAILABLE",
        message:
          "Ingresar con Google no está disponible. Podés continuar sin cuenta."
      }
    });
  }
  if (error instanceof DinerLoginInvalidError) {
    throw unauthorized(
      "DINER_LOGIN_INVALID",
      "No pudimos completar el ingreso. Probá de nuevo."
    );
  }
  if (error instanceof DinerSessionInvalidError) {
    throw unauthorized(
      "DINER_SESSION_INVALID",
      "Tu sesión terminó. Volvé a ingresar."
    );
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  if (code === "PT281") {
    throw unauthorized(
      "DINER_SESSION_INVALID",
      "Tu sesión terminó. Volvé a ingresar."
    );
  }
  const mapped = code ? messages[code] : undefined;
  if (mapped) {
    throw new ConflictException({
      error: { code: mapped[0], message: mapped[1] }
    });
  }
  throw error;
}
