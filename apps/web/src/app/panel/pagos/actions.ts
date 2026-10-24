"use server";

import {
  parsePaymentMethodKey,
  parsePaymentMethodUpdate,
  parsePaymentSecretRequest
} from "@platform/contracts";

import { adminApi } from "../admin-api";
import {
  parsePaymentList,
  type PaymentsActionState,
  type PaymentsCommand
} from "./payments";

const state = (
  status: PaymentsActionState["status"],
  message: string,
  methods: PaymentsActionState["methods"] = null
): PaymentsActionState => ({ message, methods, status });

/**
 * A credential only travels forward to the API. The returned state carries
 * statuses (never the secret), so it cannot leak back to the browser.
 */
export async function paymentsCommandAction(
  command: PaymentsCommand
): Promise<PaymentsActionState> {
  const method = parsePaymentMethodKey(command?.method);
  if (!method) return state("error", "Medio de pago inválido.");

  let path = `/v1/tenant/payment-methods/${method}`;
  let verb: "DELETE" | "PUT" = "PUT";
  let body: unknown;
  let success: string;

  switch (command.type) {
    case "update": {
      const input = {
        enabled: command.enabled,
        ...(command.publicKey === null
          ? {}
          : {
              publicConfig: command.publicKey
                ? { publicKey: command.publicKey }
                : {}
            })
      };
      if (!parsePaymentMethodUpdate(method, input).ok) {
        return state("invalid", "Revisá la configuración del medio de pago.");
      }
      body = input;
      success = command.enabled
        ? "Medio de pago guardado."
        : "Medio de pago deshabilitado.";
      break;
    }
    case "credential": {
      if (!parsePaymentSecretRequest(method, { secret: command.secret }).ok) {
        return state("invalid", "La credencial no tiene un formato válido.");
      }
      path += "/credential";
      body = { secret: command.secret };
      success = "Credencial guardada de forma cifrada.";
      break;
    }
    case "clear-credential":
      path += "/credential";
      verb = "DELETE";
      success = "Credencial eliminada. El medio quedó deshabilitado.";
      break;
    default:
      return state("error", "La acción no es válida.");
  }

  try {
    const result = await adminApi(path, { body, method: verb });
    if (!result.ok) {
      if (result.status === 401) {
        return state("error", "La sesión venció. Volvé a ingresar.");
      }
      return state(
        result.status === 400 || result.status === 422 || result.status === 409
          ? "invalid"
          : "error",
        result.message ?? "No pudimos guardar los cambios. Intentá nuevamente."
      );
    }
    return state("saved", success, parsePaymentList(result.body));
  } catch {
    return state(
      "error",
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }
}
