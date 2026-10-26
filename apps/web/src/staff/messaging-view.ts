import type {
  MessagingAutomationKind,
  MessagingAutomationStatus,
  MessagingCategory,
  MessagingEventKind,
  MessagingTemplateStatus
} from "@platform/contracts";

export const categoryLabels: Record<MessagingCategory, string> = {
  operational: "Operativa",
  promotional: "Promocional"
};

export const approvalLabels: Record<MessagingTemplateStatus, string> = {
  approved: "Aprobada",
  pending: "En revisión",
  rejected: "Rechazada"
};

export const automationLabels: Record<MessagingAutomationKind, string> = {
  birthday: "Cumpleaños",
  inactivity: "Inactividad",
  reward_earned: "Premio ganado",
  reward_expiring: "Premio por vencer"
};

export const automationStatusLabels: Record<MessagingAutomationStatus, string> =
  {
    approved: "Aprobada",
    not_configured: "Sin configurar",
    paused: "Pausada",
    pending_approval: "Pendiente de aprobación"
  };

export const eventLabels: Record<MessagingEventKind, string> = {
  blocked: "Bloqueado",
  cancelled: "Cancelado",
  deferred: "Pospuesto",
  delivered: "Entregado",
  failed: "Fallido",
  opt_out: "Baja",
  queued: "En cola",
  read: "Leído",
  retry_scheduled: "Reintento programado",
  sent: "Enviado"
};

const reasonLabels: Record<string, string> = {
  anonymized_profile: "Perfil anonimizado",
  automation_not_approved: "Automatización sin aprobar",
  cancelled_by_manager: "Cancelado por el Encargado",
  disconnected: "Se desconectó el número",
  inactive_12_months: "12 meses sin actividad",
  lost_lease: "Se perdió el envío; no se reintenta",
  marketing_consent_missing: "Sin consentimiento de promociones",
  monthly_cap: "Tope mensual (8)",
  no_phone: "Sin teléfono",
  not_confirmed: "Evento sin confirmar",
  not_connected: "Número no conectado",
  opt_out: "La persona respondió BAJA",
  outside_hours: "Fuera de horario (10 a 20)",
  policy_error: "No se pudo evaluar la política",
  sending_disabled: "Los envíos están apagados",
  template_changed: "La plantilla cambió",
  template_not_approved: "Plantilla sin aprobar",
  weekly_cap: "Tope semanal (2)",
  whatsapp_baja: "La persona respondió BAJA",
  whatsapp_consent_missing: "Sin consentimiento de WhatsApp"
};

export function reasonLabel(reason: string | null): string {
  if (!reason) return "";
  if (reason.startsWith("retries_exhausted"))
    return "Se agotaron los reintentos";
  return reasonLabels[reason] ?? reason;
}

export function costLabel(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    style: "currency"
  }).format(cents / 100);
}

export function whenLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}
