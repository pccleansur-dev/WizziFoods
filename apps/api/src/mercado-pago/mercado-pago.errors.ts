import {
  BadRequestException,
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

export function invalidPaymentRequest(): BadRequestException {
  return new BadRequestException({
    error: {
      code: "INVALID_ONLINE_PAYMENT_REQUEST",
      message: "Revisá los datos de la operación."
    }
  });
}

/** Translates database failures without echoing any database detail. */
export function mapPaymentFailure(error: unknown): never {
  switch (databaseCode(error)) {
    case "PT100":
      throw new ConflictException({
        error: {
          code: "WAITER_COMMAND_REUSED",
          message:
            "Esa operación ya se usó con otros datos. Volvé a intentarlo."
        }
      });
    case "PT200":
      throw new ForbiddenException({
        error: {
          code: "STAFF_FORBIDDEN",
          message: "No tenés permiso para operar pagos."
        }
      });
    case "PT201":
      throw new NotFoundException({
        error: {
          code: "ONLINE_PAYMENT_NOT_FOUND",
          message: "No encontramos ese pedido o ese pago."
        }
      });
    case "PT212":
      throw invalidPaymentRequest();
    case "PT222":
      throw new ForbiddenException({
        error: {
          code: "MANAGER_REQUIRED",
          message: "Esta decisión la toma el Encargado."
        }
      });
    case "PT242":
      throw new ConflictException({
        error: {
          code: "REFUND_EXCEEDS_LIMIT",
          message:
            "La devolución supera el saldo a favor o lo cobrado en ese pago."
        }
      });
    case "PT252":
      throw new ConflictException({
        error: {
          code: "INTENT_NOT_PAYABLE",
          message: "Este pedido ya no espera un pago online."
        }
      });
    case "PT253":
      throw new ConflictException({
        error: {
          code: "PAYMENT_MISMATCH",
          message: "El pago informado no coincide con el pedido."
        }
      });
    default:
      throw error;
  }
}
