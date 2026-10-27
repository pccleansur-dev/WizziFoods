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
