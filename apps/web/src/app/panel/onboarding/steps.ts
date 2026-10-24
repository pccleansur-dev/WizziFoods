import type { ReadinessCode, ReadinessReport } from "@platform/contracts";

export type OnboardingStepKey =
  "carta" | "equipo" | "negocio" | "pagos" | "publicar" | "salon";

export const ONBOARDING_STEPS = [
  {
    description: "Datos, contacto, idiomas y estilo visual.",
    href: "/panel/negocio",
    key: "negocio",
    title: "Negocio"
  },
  {
    description: "Categorías, sectores y productos.",
    href: "/panel/carta",
    key: "carta",
    title: "Carta"
  },
  {
    description: "El plano con las mesas y sus QR.",
    href: "/panel/plano",
    key: "salon",
    title: "Salón y QR"
  },
  {
    description: "Cómo cobra el negocio.",
    href: "/panel/pagos",
    key: "pagos",
    title: "Pagos"
  },
  {
    description: "Cuentas del personal. Es opcional.",
    href: "/panel/equipo",
    key: "equipo",
    title: "Equipo"
  },
  {
    description: "Requisitos, modo prueba y apertura.",
    href: "/panel/publicar",
    key: "publicar",
    title: "Probar y publicar"
  }
] as const satisfies readonly {
  description: string;
  href: string;
  key: OnboardingStepKey;
  title: string;
}[];

export type OnboardingStepStatus = "blocked" | "done" | "optional" | "pending";

export type OnboardingStepState = {
  description: string;
  href: string;
  key: OnboardingStepKey;
  /** Lo que falta para completar el paso (explicaciones de la matriz). */
  missing: string[];
  /** Recomendaciones que no impiden completarlo. */
  notes: string[];
  status: OnboardingStepStatus;
  title: string;
};

export type OnboardingProgress = {
  /** Primer paso que conviene abrir. */
  next: OnboardingStepKey;
  /** Avance sobre los cinco pasos obligatorios. */
  percent: number;
  steps: OnboardingStepState[];
};

const stepOfCode: Partial<Record<ReadinessCode, OnboardingStepKey>> = {
  CATALOG_DRAFT_UNPUBLISHED: "carta",
  CATALOG_IMPORTS_PENDING: "carta",
  CATALOG_LANGUAGE_MISSING: "carta",
  CATALOG_NOT_PUBLISHED: "carta",
  FLOOR_NO_TABLES: "salon",
  FLOOR_TABLE_WITHOUT_QR: "salon",
  PAYMENT_NO_METHOD: "pagos",
  PROFILE_CONTACT_MISSING: "negocio",
  PROFILE_MISSING: "negocio",
  TEAM_EMPTY: "equipo"
};

const REQUIRED: readonly OnboardingStepKey[] = [
  "negocio",
  "carta",
  "salon",
  "pagos",
  "publicar"
];

/**
 * Estado de cada pantalla del asistente, a partir de la misma matriz que decide
 * si se puede publicar. Equipo es opcional y nunca bloquea; publicar queda
 * bloqueado hasta que los otros pasos obligatorios se cumplen.
 */
export function onboardingProgress(
  readiness: ReadinessReport | null
): OnboardingProgress {
  const items = readiness?.items ?? [];
  const steps: OnboardingStepState[] = ONBOARDING_STEPS.map((step) => {
    const own = items.filter((item) => stepOfCode[item.code] === step.key);
    const missing = own
      .filter((item) => item.severity === "blocker")
      .map((item) => item.message);
    const notes = own
      .filter((item) => item.severity === "warning")
      .map((item) => item.message);
    let status: OnboardingStepStatus;
    if (!readiness) status = "pending";
    else if (step.key === "publicar") {
      status = readiness.published
        ? "done"
        : readiness.ready
          ? "pending"
          : "blocked";
    } else if (step.key === "equipo") {
      status = notes.length > 0 ? "optional" : "done";
    } else {
      status = missing.length === 0 ? "done" : "pending";
    }
    return { ...step, missing, notes, status };
  });

  const done = steps.filter(
    ({ key, status }) => REQUIRED.includes(key) && status === "done"
  ).length;
  const next =
    steps.find(
      ({ key, status }) =>
        REQUIRED.includes(key) && (status === "pending" || status === "blocked")
    )?.key ?? "publicar";

  return {
    next,
    percent: Math.round((done / REQUIRED.length) * 100),
    steps
  };
}
