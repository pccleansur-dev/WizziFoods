/**
 * Matriz de requisitos para abrir el negocio (T15). La base decide qué falta;
 * este módulo sólo le da a cada código su explicación y el paso del panel que
 * lo resuelve, y rechaza los códigos que no conoce.
 */

export const BLOCKER_CODES = [
  "PROFILE_MISSING",
  "PROFILE_CONTACT_MISSING",
  "CATALOG_NOT_PUBLISHED",
  "CATALOG_LANGUAGE_MISSING",
  "FLOOR_NO_TABLES",
  "FLOOR_TABLE_WITHOUT_QR",
  "PAYMENT_NO_METHOD"
] as const;

export const WARNING_CODES = [
  "CATALOG_DRAFT_UNPUBLISHED",
  "CATALOG_IMPORTS_PENDING",
  "TEAM_EMPTY"
] as const;

export const READINESS_CODES = [...BLOCKER_CODES, ...WARNING_CODES] as const;

export type ReadinessBlockerCode = (typeof BLOCKER_CODES)[number];
export type ReadinessWarningCode = (typeof WARNING_CODES)[number];
export type ReadinessCode = (typeof READINESS_CODES)[number];

export type ReadinessItem = {
  code: ReadinessCode;
  href: string;
  message: string;
  severity: "blocker" | "warning";
};

export type ReadinessPublication = { at: string; by: string; revision: number };

export type ReadinessReport = {
  items: ReadinessItem[];
  published: ReadinessPublication | null;
  ready: boolean;
  team: { activeManagers: number; activeMembers: number };
};

const matrix: Record<ReadinessCode, { href: string; message: string }> = {
  CATALOG_DRAFT_UNPUBLISHED: {
    href: "/panel",
    message:
      "Hay cambios de la carta sin publicar: los clientes siguen viendo la última versión publicada."
  },
  CATALOG_IMPORTS_PENDING: {
    href: "/panel",
    message:
      "Hay importaciones de carta sin aprobar: no forman parte de la carta hasta que las apruebes y la publiques."
  },
  CATALOG_LANGUAGE_MISSING: {
    href: "/panel",
    message:
      "La carta publicada no tiene título en todos los idiomas del negocio. Completá las traducciones y publicá de nuevo."
  },
  CATALOG_NOT_PUBLISHED: {
    href: "/panel",
    message:
      "Publicá la carta con al menos una categoría, un sector y un producto."
  },
  FLOOR_NO_TABLES: {
    href: "/panel/plano",
    message: "Dibujá el plano del salón con al menos una mesa."
  },
  FLOOR_TABLE_WITHOUT_QR: {
    href: "/panel/plano",
    message:
      "Hay mesas activas sin QR vigente. Regenerá el QR de cada mesa antes de abrir."
  },
  PAYMENT_NO_METHOD: {
    href: "/panel/pagos",
    message:
      "Habilitá al menos un medio de pago disponible, por ejemplo efectivo."
  },
  PROFILE_CONTACT_MISSING: {
    href: "/panel",
    message:
      "Cargá un teléfono o una dirección para que tus clientes te ubiquen."
  },
  PROFILE_MISSING: {
    href: "/panel",
    message:
      "Guardá los datos del negocio: nombre, idiomas y estilo visual de la carta."
  },
  TEAM_EMPTY: {
    href: "/panel/equipo",
    message:
      "Todavía no cargaste empleados. No es obligatorio para publicar, pero nadie podrá operar con PIN."
  }
};

export function describeReadiness(
  codes: readonly ReadinessCode[]
): ReadinessItem[] {
  return codes.map((code) => ({
    code,
    href: matrix[code].href,
    message: matrix[code].message,
    severity: (BLOCKER_CODES as readonly string[]).includes(code)
      ? "blocker"
      : "warning"
  }));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

function codesFrom<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      !(allowed as readonly string[]).includes(entry) ||
      seen.has(entry)
    ) {
      return null;
    }
    seen.add(entry);
  }
  return value as T[];
}

const isoPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function parseReadinessReport(value: unknown): ReadinessReport | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, ["blockers", "published", "team", "warnings"])) {
    return null;
  }
  const blockers = codesFrom(raw.blockers, BLOCKER_CODES);
  const warnings = codesFrom(raw.warnings, WARNING_CODES);
  const team = record(raw.team);
  if (
    !blockers ||
    !warnings ||
    !team ||
    !exactKeys(team, ["activeManagers", "activeMembers"])
  ) {
    return null;
  }
  const activeManagers = count(team.activeManagers);
  const activeMembers = count(team.activeMembers);
  if (activeManagers === null || activeMembers === null) return null;

  let published: ReadinessPublication | null = null;
  if (raw.published !== null) {
    const entry = record(raw.published);
    if (
      !entry ||
      !exactKeys(entry, ["at", "by", "revision"]) ||
      typeof entry.at !== "string" ||
      !isoPattern.test(entry.at) ||
      typeof entry.by !== "string" ||
      !uuidPattern.test(entry.by) ||
      typeof entry.revision !== "number" ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 1
    ) {
      return null;
    }
    published = { at: entry.at, by: entry.by, revision: entry.revision };
  }

  return {
    items: describeReadiness([...blockers, ...warnings]),
    published,
    ready: blockers.length === 0,
    team: { activeManagers, activeMembers }
  };
}

export type PublicationParseResult = { ok: boolean };

/** Publicar no recibe datos: tenant, ubicación y estado salen de la sesión. */
export function parsePublicationRequest(
  value: unknown
): PublicationParseResult {
  if (value === undefined || value === null) return { ok: true };
  const body = record(value);
  return { ok: body !== null && Object.keys(body).length === 0 };
}

export const SANDBOX_STEPS = [
  "qr_scanned",
  "order_placed",
  "in_production",
  "payment_recorded",
  "closed",
  "cleaned_up"
] as const;

export type SandboxStep = (typeof SANDBOX_STEPS)[number];

export const sandboxStepLabels: Record<SandboxStep, string> = {
  cleaned_up: "Limpieza de datos simulados",
  closed: "Cierre de la mesa",
  in_production: "Producción",
  order_placed: "Pedido",
  payment_recorded: "Pago simulado",
  qr_scanned: "Lectura del QR"
};

export type SandboxRun = {
  namespace: "sandbox";
  reference: string;
  runId: string;
  steps: { ok: boolean; step: SandboxStep }[];
};

export function parseSandboxRun(value: unknown): SandboxRun | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, ["namespace", "reference", "runId", "steps"])) {
    return null;
  }
  if (
    raw.namespace !== "sandbox" ||
    typeof raw.reference !== "string" ||
    !/^SBX-[0-9A-Z]{4,12}$/u.test(raw.reference) ||
    typeof raw.runId !== "string" ||
    !uuidPattern.test(raw.runId) ||
    !Array.isArray(raw.steps) ||
    raw.steps.length !== SANDBOX_STEPS.length
  ) {
    return null;
  }
  const steps: SandboxRun["steps"] = [];
  for (const [index, entry] of raw.steps.entries()) {
    const step = record(entry);
    if (
      !step ||
      !exactKeys(step, ["ok", "step"]) ||
      typeof step.ok !== "boolean" ||
      step.step !== SANDBOX_STEPS[index]
    ) {
      return null;
    }
    steps.push({ ok: step.ok, step: step.step as SandboxStep });
  }
  return {
    namespace: "sandbox",
    reference: raw.reference,
    runId: raw.runId,
    steps
  };
}
