import { randomBytes } from "node:crypto";

import type { ProviderTemplate } from "@platform/contracts";

import type {
  ListTemplatesInput,
  SendTemplateInput,
  SendTemplateResult,
  WhatsappProvider
} from "./whatsapp-provider.js";

export const simulatedTemplates: readonly ProviderTemplate[] = [
  {
    body: "Hola {{1}}, ganaste un premio de {{2}}. Mostralo en tu próxima visita.",
    category: "operational",
    language: "es_AR",
    name: "premio_ganado",
    status: "approved"
  },
  {
    body: "Hola {{1}}, tu premio vence el {{2}}. ¡Te esperamos!",
    category: "operational",
    language: "es_AR",
    name: "premio_por_vencer",
    status: "approved"
  },
  {
    body: "¡Feliz cumpleaños, {{1}}! Te esperamos para festejarlo.",
    category: "promotional",
    language: "es_AR",
    name: "feliz_cumple",
    status: "approved"
  },
  {
    body: "Hola {{1}}, hace tiempo que no te vemos. Respondé BAJA para no recibir más.",
    category: "promotional",
    language: "es_AR",
    name: "te_extranamos",
    status: "approved"
  },
  {
    body: "Hola {{1}}, tenemos una novedad. Respondé BAJA para no recibir más.",
    category: "promotional",
    language: "es_AR",
    name: "novedad_en_revision",
    status: "pending"
  }
];

/** The simulator is for development and tests: it must never run in production. */
export function assertSimulatedWhatsappAllowed(environment: string): void {
  if (environment === "production") {
    throw new Error(
      "The simulated WhatsApp provider is not allowed in production"
    );
  }
}

/**
 * A provider that sends nothing. It records what it was asked to send and can be told
 * to fail, so limits, retries and opt-outs are tested without Meta.
 */
export class SimulatedWhatsappProvider implements WhatsappProvider {
  readonly sent: SendTemplateInput[] = [];
  templates: ProviderTemplate[] = simulatedTemplates.map((entry) => ({
    ...entry
  }));
  private failures: Array<{
    error: string;
    status: "permanent_failure" | "transient_failure";
  }> = [];

  constructor(environment = "development") {
    assertSimulatedWhatsappAllowed(environment);
  }

  /** The next `count` sends fail in the way given. */
  failNext(
    status: "permanent_failure" | "transient_failure",
    count = 1,
    error = status === "transient_failure"
      ? "simulated timeout"
      : "simulated rejection"
  ): void {
    for (let n = 0; n < count; n += 1) this.failures.push({ error, status });
  }

  listTemplates(input: ListTemplatesInput): Promise<ProviderTemplate[]> {
    void input;
    return Promise.resolve(this.templates.map((entry) => ({ ...entry })));
  }

  sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult> {
    const failure = this.failures.shift();
    if (failure) return Promise.resolve(failure);
    this.sent.push(input);
    return Promise.resolve({
      // Unique like the real ones: the database refuses a repeated provider id.
      providerMessageId: `wamid.SIM${randomBytes(8).toString("hex")}`,
      status: "sent"
    });
  }
}
