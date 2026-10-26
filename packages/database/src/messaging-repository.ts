import {
  parseBeginSendResult,
  parseDecidedOneOff,
  parseMessagingAudience,
  parseMessagingEvents,
  parseMessagingOverview,
  parseProposedOneOff,
  parseTenantScope,
  type BeginSendResult,
  type DecidedOneOff,
  type MessagingAudienceMember,
  type MessagingEvent,
  type MessagingOverview,
  type ProposedOneOff,
  type ProviderTemplate,
  type SendOutcome,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StaffScope = { scope: TenantScope; staffId: string };

export type SealedWhatsappCredential = {
  ciphertext: Buffer;
  keyVersion: number;
};

export type WhatsappCredentials = SealedWhatsappCredential & {
  phoneNumberId: string;
  wabaId: string;
};

export type ClaimedMessage = {
  id: string;
  scope: TenantScope;
};

export type DeliveryOutcome =
  "applied" | "unchanged" | "unknown_message" | "unknown_number";
export type OptOutOutcome =
  "applied" | "ignored" | "unchanged" | "unknown_number";
export type MessagingWebhookClaim = "duplicate" | "new" | "retry";
export type MessagingWebhookOutcome =
  | "applied"
  | "failed"
  | "ignored"
  | "unchanged"
  | "unknown_message"
  | "unknown_number";

/**
 * Messaging for the Encargado (staff side), for the worker that sends and for the
 * webhook that reports back. Whether a message may leave is decided in the database,
 * in one function, when the worker begins the send; nothing here re-decides it.
 */
export interface MessagingRepository {
  // Staff side
  connect(
    input: StaffScope & {
      credential: SealedWhatsappCredential;
      displayPhone: string | null;
      phoneNumberId: string;
      wabaId: string;
    }
  ): Promise<MessagingOverview>;
  decideAutomation(
    input: StaffScope & {
      automationId: string;
      decision: "approve" | "pause" | "resume";
    }
  ): Promise<MessagingOverview>;
  decideOneOff(
    input: StaffScope & { batchId: string; decision: "cancel" | "confirm" }
  ): Promise<DecidedOneOff>;
  disconnect(input: StaffScope): Promise<MessagingOverview>;
  getOverview(input: StaffScope): Promise<MessagingOverview>;
  listAudience(input: StaffScope): Promise<MessagingAudienceMember[]>;
  listEvents(input: StaffScope & { limit: number }): Promise<MessagingEvent[]>;
  proposeOneOff(
    input: StaffScope & {
      commandId: string;
      profileIds: string[];
      templateId: string;
      variables: string[];
    }
  ): Promise<ProposedOneOff>;
  readCredentials(scope: TenantScope): Promise<WhatsappCredentials | null>;
  saveAutomation(
    input: StaffScope & { kind: string; templateId: string }
  ): Promise<MessagingOverview>;
  setSending(
    input: StaffScope & { enabled: boolean }
  ): Promise<MessagingOverview>;
  setTemplateCost(
    input: StaffScope & { estimatedCostCents: number; templateId: string }
  ): Promise<MessagingOverview>;
  upsertTemplates(
    input: StaffScope & { templates: ProviderTemplate[] }
  ): Promise<MessagingOverview>;

  // Worker side
  beginSend(input: {
    outboxId: string;
    scope: TenantScope;
  }): Promise<BeginSendResult>;
  claimOutbox(input: {
    leaseSeconds: number;
    limit: number;
  }): Promise<ClaimedMessage[]>;
  enqueueDueAutomations(): Promise<number>;
  finishSend(input: {
    error: string | null;
    outboxId: string;
    outcome: SendOutcome;
    providerMessageId: string | null;
    scope: TenantScope;
  }): Promise<{ applied: boolean; status?: string }>;

  // Webhook side
  claimWebhookEvent(input: {
    eventKey: string;
    topic: string;
  }): Promise<MessagingWebhookClaim>;
  finishWebhookEvent(input: {
    eventKey: string;
    outcome: MessagingWebhookOutcome;
  }): Promise<void>;
  recordDelivery(input: {
    error: string | null;
    phoneNumberId: string;
    providerMessageId: string;
    status: "delivered" | "failed" | "read";
  }): Promise<DeliveryOutcome>;
  recordOptOut(input: {
    phone: string;
    phoneNumberId: string;
  }): Promise<OptOutOutcome>;
}

type ResultRow = { result: unknown };

function uuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a uuid`);
  return value;
}

function scopeOf(value: TenantScope): TenantScope {
  const parsed = parseTenantScope(value);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function canonical<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label} must be canonical`);
  return value;
}

function overviewOf(row: ResultRow | undefined): MessagingOverview {
  return canonical(parseMessagingOverview(row?.result), "messaging overview");
}

export function createMessagingRepository(client: Sql): MessagingRepository {
  return {
    async connect(input) {
      const scope = scopeOf(input.scope);
      const { credential } = input;
      if (
        !Buffer.isBuffer(credential.ciphertext) ||
        credential.ciphertext.length < 29 ||
        credential.ciphertext.length > 4096 ||
        !Number.isInteger(credential.keyVersion)
      ) {
        throw new Error("sealed credential must be canonical");
      }
      const [row] = await client<ResultRow[]>`
        select private.connect_whatsapp(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${input.phoneNumberId}::text, ${input.wabaId}::text,
          ${input.displayPhone}::text,
          ${credential.ciphertext}::bytea, ${credential.keyVersion}::smallint
        ) as result
      `;
      return overviewOf(row);
    },

    async decideAutomation(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.decide_messaging_automation(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${uuid(input.automationId, "automation id")}::uuid,
          ${input.decision}::text
        ) as result
      `;
      return overviewOf(row);
    },

    async decideOneOff(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.decide_one_off_event(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${uuid(input.batchId, "batch id")}::uuid,
          ${input.decision}::text
        ) as result
      `;
      return canonical(parseDecidedOneOff(row?.result), "one-off decision");
    },

    async disconnect(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.disconnect_whatsapp(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid
        ) as result
      `;
      return overviewOf(row);
    },

    async getOverview(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.get_messaging_overview(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid
        ) as result
      `;
      return overviewOf(row);
    },

    async listAudience(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.list_messaging_audience(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid
        ) as result
      `;
      return canonical(parseMessagingAudience(row?.result), "audience");
    },

    async listEvents(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.list_messaging_events(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid, ${input.limit}::integer
        ) as result
      `;
      return canonical(parseMessagingEvents(row?.result), "messaging events");
    },

    async proposeOneOff(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.propose_one_off_event(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${uuid(input.commandId, "command id")}::uuid,
          ${uuid(input.templateId, "template id")}::uuid,
          ${input.profileIds.map((id) => uuid(id, "profile id"))}::uuid[],
          ${JSON.stringify(input.variables)}::text::jsonb
        ) as result
      `;
      return canonical(parseProposedOneOff(row?.result), "one-off event");
    },

    async readCredentials(rawScope) {
      const scope = scopeOf(rawScope);
      const [row] = await client<ResultRow[]>`
        select private.read_whatsapp_credentials(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid
        ) as result
      `;
      const root = row?.result;
      if (root === null || root === undefined) return null;
      if (
        typeof root !== "object" ||
        typeof (root as Record<string, unknown>).ciphertext !== "string" ||
        typeof (root as Record<string, unknown>).keyVersion !== "number" ||
        typeof (root as Record<string, unknown>).phoneNumberId !== "string" ||
        typeof (root as Record<string, unknown>).wabaId !== "string"
      ) {
        throw new Error("whatsapp credentials must be canonical");
      }
      const value = root as {
        ciphertext: string;
        keyVersion: number;
        phoneNumberId: string;
        wabaId: string;
      };
      return {
        ciphertext: Buffer.from(value.ciphertext, "base64"),
        keyVersion: value.keyVersion,
        phoneNumberId: value.phoneNumberId,
        wabaId: value.wabaId
      };
    },

    async saveAutomation(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.save_messaging_automation(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${input.kind}::text, ${uuid(input.templateId, "template id")}::uuid
        ) as result
      `;
      return overviewOf(row);
    },

    async setSending(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.set_whatsapp_sending(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid, ${input.enabled}::boolean
        ) as result
      `;
      return overviewOf(row);
    },

    async setTemplateCost(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.set_whatsapp_template_cost(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${uuid(input.templateId, "template id")}::uuid,
          ${input.estimatedCostCents}::numeric
        ) as result
      `;
      return overviewOf(row);
    },

    async upsertTemplates(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.upsert_whatsapp_templates(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.staffId, "staff id")}::uuid,
          ${JSON.stringify(input.templates)}::text::jsonb
        ) as result
      `;
      return overviewOf(row);
    },

    async beginSend(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.begin_messaging_send(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.outboxId, "outbox id")}::uuid
        ) as result
      `;
      return canonical(parseBeginSendResult(row?.result), "send decision");
    },

    async claimOutbox(input) {
      const [row] = await client<ResultRow[]>`
        select private.claim_messaging_outbox(
          ${input.limit}::integer, ${input.leaseSeconds}::integer
        ) as result
      `;
      const items = Array.isArray(row?.result) ? row.result : [];
      return items.map((item: unknown) => {
        const entry = item as {
          id: string;
          locationId: string;
          tenantId: string;
        };
        return {
          id: uuid(entry.id, "outbox id"),
          scope: scopeOf({
            locationId: entry.locationId,
            tenantId: entry.tenantId
          })
        };
      });
    },

    async enqueueDueAutomations() {
      const [row] = await client<ResultRow[]>`
        select private.enqueue_due_messaging_automations() as result
      `;
      const queued = (row?.result as { queued?: unknown } | undefined)?.queued;
      return typeof queued === "number" ? queued : 0;
    },

    async finishSend(input) {
      const scope = scopeOf(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.finish_messaging_send(
          ${scope.tenantId}::uuid, ${scope.locationId}::uuid,
          ${uuid(input.outboxId, "outbox id")}::uuid,
          ${input.outcome}::text, ${input.providerMessageId}::text,
          ${input.error?.slice(0, 300) ?? null}::text
        ) as result
      `;
      const value = row?.result as { applied?: unknown; status?: unknown };
      return {
        applied: value?.applied === true,
        ...(typeof value?.status === "string" ? { status: value.status } : {})
      };
    },

    async claimWebhookEvent(input) {
      const [row] = await client<{ result: MessagingWebhookClaim }[]>`
        select private.claim_messaging_webhook_event(
          ${input.eventKey}::text, ${input.topic}::text
        ) as result
      `;
      return canonical(row?.result ?? null, "webhook claim");
    },

    async finishWebhookEvent(input) {
      await client`
        select private.finish_messaging_webhook_event(
          ${input.eventKey}::text, ${input.outcome}::text
        )
      `;
    },

    async recordDelivery(input) {
      const [row] = await client<{ result: DeliveryOutcome }[]>`
        select private.record_messaging_delivery(
          ${input.phoneNumberId}::text, ${input.providerMessageId}::text,
          ${input.status}::text, ${input.error}::text
        ) as result
      `;
      return canonical(row?.result ?? null, "delivery outcome");
    },

    async recordOptOut(input) {
      const [row] = await client<{ result: OptOutOutcome }[]>`
        select private.record_whatsapp_opt_out(
          ${input.phoneNumberId}::text, ${input.phone}::text
        ) as result
      `;
      return canonical(row?.result ?? null, "opt-out outcome");
    }
  };
}
