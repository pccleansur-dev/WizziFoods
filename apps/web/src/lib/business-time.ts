/**
 * Fecha y hora en la zona del negocio (Argentina), no en la del servidor: los contenedores corren
 * en UTC y un comprobante impreso mostraba tres horas de más, y hasta el día siguiente de noche.
 * Es la misma zona que ya usa el panel del superadmin y el valor por defecto de `locations.timezone`.
 */
export const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";

export function formatBusinessDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: BUSINESS_TIME_ZONE
  }).format(new Date(value));
}
