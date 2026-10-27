import type { LiveStatus } from "./live-sync";

/**
 * What a screen tells the person about its connection. Only the degraded states say
 * anything: a live or polling screen is just a working screen.
 */
export function connectionMessage(
  status: LiveStatus,
  lastSyncAt: number | null
): string | null {
  if (status === "offline") {
    const since =
      lastSyncAt === null
        ? ""
        : ` de las ${new Date(lastSyncAt).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit"
          })}`;
    return `Sin conexión. Estás viendo la última información${since}. Lo que hagas ahora no se envía hasta que vuelva la conexión.`;
  }
  if (status === "reconnecting") {
    return "No podemos comunicarnos con el servidor. La información puede estar desactualizada; seguimos intentando.";
  }
  return null;
}

/** An action that changes something must not leave while the device cannot reach the server. */
export const OFFLINE_ACTION_MESSAGE =
  "Sin conexión: no se envió nada. Volvé a intentarlo cuando vuelva la conexión.";

/**
 * The call itself failed on the way (the device lost the network, the server restarted):
 * nobody knows whether the server did it. Repeating is safe because the same command id
 * is kept, so the server answers with what it already did instead of doing it twice.
 */
export const UNKNOWN_OUTCOME_MESSAGE =
  "No pudimos confirmar si se envió. Podés volver a intentarlo: no se repite.";
