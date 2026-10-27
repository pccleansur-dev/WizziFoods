/**
 * WhatsApp and basic automations (T30). The restaurant comes from the staff session and
 * the diner from the profile the database holds; no request names a tenant, no response
 * carries a credential, a phone number of a diner, an email or an account id.
 */
export type MessagingCategory = "operational" | "promotional";
export type MessagingTemplateStatus = "approved" | "pending" | "rejected";
export type MessagingAutomationKind =
  "birthday" | "inactivity" | "reward_earned" | "reward_expiring";
export type MessagingAutomationStatus =
  "approved" | "not_configured" | "paused" | "pending_approval";
export type MessagingEventKind =
  | "blocked"
  | "cancelled"
  | "deferred"
  | "delivered"
  | "failed"
  | "opt_out"
  | "queued"
  | "read"
  | "retry_scheduled"
  | "sent";

export type MessagingChannel = "web_push" | "whatsapp";

export type MessagingTemplate = {
  approvalStatus: MessagingTemplateStatus;
  body: string;
  category: MessagingCategory;
  channel: MessagingChannel;
  estimatedCostCents: number;
  id: string;
  language: string;
  name: string;
};

export type MessagingConnection = {
  connectedAt: string;
  displayPhone: string | null;
  phoneNumberId: string;
  sendingEnabled: boolean;
  wabaId: string;
};

export type MessagingAutomation = {
  approvedAt: string | null;
  channel: MessagingChannel;
  id: string | null;
  kind: MessagingAutomationKind;
  status: MessagingAutomationStatus;
  templateId: string | null;
  templateName: string | null;
};

export type MessagingOneOffEvent = {
  batchId: string;
  recipients: number;
  templateName: string;
};

export type MessagingOverview = {
  automations: MessagingAutomation[];
  connection: MessagingConnection | null;
  oneOffEvents: MessagingOneOffEvent[];
  /** Notifications of the installed PWA: sending switch and people reachable. */
  push: { sendingEnabled: boolean; subscribers: number };
  templates: MessagingTemplate[];
  usage: { estimatedCostCents: number; sentThisMonth: number };
};

export type MessagingEvent = {
  category: MessagingCategory | null;
  displayName: string | null;
  id: number;
  kind: MessagingEventKind;
  occurredAt: string;
  origin: "automation" | "one_off" | null;
  reason: string | null;
  templateName: string | null;
};

export type MessagingAudienceMember = {
  displayName: string;
  marketingConsent: boolean;
  profileId: string;
  /** An active push subscription, and that plus the marketing consent. */
  pushConsent: boolean;
  pushMarketingConsent: boolean;
  whatsappConsent: boolean;
};

/** The token travels only from the manager's browser to the API, once, and is sealed. */
export type ConnectWhatsappRequest = {
  accessToken: string;
  displayPhone: string | null;
  phoneNumberId: string;
  wabaId: string;
};
export type SetSendingRequest = { enabled: boolean };
export type SetTemplateCostRequest = { estimatedCostCents: number };
export type SaveAutomationRequest = {
  kind: MessagingAutomationKind;
  templateId: string;
};
export type DecideAutomationRequest = {
  decision: "approve" | "pause" | "resume";
};
export type ProposeOneOffRequest = {
  commandId: string;
  profileIds: string[];
  templateId: string;
  variables: string[];
};
export type ProposedOneOff = { batchId: string; recipients: number };
export type DecideOneOffRequest = { decision: "cancel" | "confirm" };
export type DecidedOneOff = { batchId: string; changed: number };

/** A template as the provider reports it. */
export type ProviderTemplate = {
  body: string;
  category: MessagingCategory;
  language: string;
  name: string;
  status: MessagingTemplateStatus;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phoneNumberIdPattern = /^[0-9]{5,30}$/;
const phonePattern = /^\+[1-9][0-9]{7,14}$/;
const templateNamePattern = /^[a-z0-9_]{1,100}$/;
const languagePattern = /^[a-z]{2}(_[A-Z]{2})?$/;

export const messagingAutomationKinds: readonly MessagingAutomationKind[] = [
  "reward_earned",
  "reward_expiring",
  "birthday",
  "inactivity"
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = []
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function category(value: unknown): MessagingCategory | null {
  return value === "operational" || value === "promotional" ? value : null;
}

function templateStatus(value: unknown): MessagingTemplateStatus | null {
  return value === "approved" || value === "pending" || value === "rejected"
    ? value
    : null;
}

export function isMessagingAutomationKind(
  value: unknown
): value is MessagingAutomationKind {
  return messagingAutomationKinds.includes(value as MessagingAutomationKind);
}

function channelOf(value: unknown): MessagingChannel | null {
  return value === "whatsapp" || value === "web_push" ? value : null;
}

function parseTemplate(input: unknown): MessagingTemplate | null {
  const root = record(input);
  if (!root) return null;
  const id = uuid(root.id);
  const name = text(root.name, 100);
  const language = text(root.language, 10);
  const body = text(root.body, 1024);
  const kind = category(root.category);
  const status = templateStatus(root.approvalStatus);
  const channel = channelOf(root.channel);
  const cost = root.estimatedCostCents;
  if (
    !channel ||
    !id ||
    !name ||
    !language ||
    body === null ||
    !kind ||
    !status ||
    typeof cost !== "number" ||
    cost < 0
  ) {
    return null;
  }
  return {
    approvalStatus: status,
    body,
    category: kind,
    channel,
    estimatedCostCents: cost,
    id,
    language,
    name
  };
}

function parseAutomation(input: unknown): MessagingAutomation | null {
  const root = record(input);
  if (!root || !isMessagingAutomationKind(root.kind)) return null;
  const channel = channelOf(root.channel);
  if (!channel) return null;
  const status = root.status;
  if (
    status !== "approved" &&
    status !== "not_configured" &&
    status !== "paused" &&
    status !== "pending_approval"
  ) {
    return null;
  }
  const id = root.id === null ? null : uuid(root.id);
  const templateId = root.templateId === null ? null : uuid(root.templateId);
  if (
    (root.id !== null && !id) ||
    (root.templateId !== null && !templateId) ||
    (root.templateName !== null && typeof root.templateName !== "string") ||
    (root.approvedAt !== null && typeof root.approvedAt !== "string")
  ) {
    return null;
  }
  return {
    approvedAt: root.approvedAt as string | null,
    channel,
    id,
    kind: root.kind,
    status,
    templateId,
    templateName: root.templateName as string | null
  };
}

function parseConnection(input: unknown): MessagingConnection | null {
  const root = record(input);
  if (
    !root ||
    typeof root.phoneNumberId !== "string" ||
    typeof root.wabaId !== "string" ||
    typeof root.sendingEnabled !== "boolean" ||
    typeof root.connectedAt !== "string" ||
    (root.displayPhone !== null && typeof root.displayPhone !== "string")
  ) {
    return null;
  }
  return {
    connectedAt: root.connectedAt,
    displayPhone: root.displayPhone,
    phoneNumberId: root.phoneNumberId,
    sendingEnabled: root.sendingEnabled,
    wabaId: root.wabaId
  };
}

function all<T>(
  input: unknown,
  parse: (item: unknown) => T | null
): T[] | null {
  if (!Array.isArray(input)) return null;
  const items = input.map(parse);
  return items.every((item) => item !== null) ? (items as T[]) : null;
}

export function parseMessagingOverview(
  input: unknown
): MessagingOverview | null {
  const root = record(input);
  if (!root) return null;
  const templates = all(root.templates, parseTemplate);
  const automations = all(root.automations, parseAutomation);
  const oneOffEvents = all(root.oneOffEvents, (item) => {
    const entry = record(item);
    const batchId = entry ? uuid(entry.batchId) : null;
    return entry &&
      batchId &&
      typeof entry.templateName === "string" &&
      typeof entry.recipients === "number"
      ? {
          batchId,
          recipients: entry.recipients,
          templateName: entry.templateName
        }
      : null;
  });
  const usage = record(root.usage);
  const push = record(root.push);
  const connection =
    root.connection === null ? null : parseConnection(root.connection);
  if (
    !templates ||
    !automations ||
    !oneOffEvents ||
    !usage ||
    !push ||
    typeof push.sendingEnabled !== "boolean" ||
    typeof push.subscribers !== "number" ||
    typeof usage.sentThisMonth !== "number" ||
    typeof usage.estimatedCostCents !== "number" ||
    (root.connection !== null && !connection)
  ) {
    return null;
  }
  return {
    automations,
    connection,
    oneOffEvents,
    push: {
      sendingEnabled: push.sendingEnabled,
      subscribers: push.subscribers
    },
    templates,
    usage: {
      estimatedCostCents: usage.estimatedCostCents,
      sentThisMonth: usage.sentThisMonth
    }
  };
}

const eventKinds: readonly MessagingEventKind[] = [
  "blocked",
  "cancelled",
  "deferred",
  "delivered",
  "failed",
  "opt_out",
  "queued",
  "read",
  "retry_scheduled",
  "sent"
];

export function parseMessagingEvents(input: unknown): MessagingEvent[] | null {
  return all(input, (item) => {
    const root = record(item);
    if (
      !root ||
      typeof root.id !== "number" ||
      !eventKinds.includes(root.kind as MessagingEventKind) ||
      typeof root.occurredAt !== "string"
    ) {
      return null;
    }
    const kind = root.category === null ? null : category(root.category);
    if (root.category !== null && !kind) return null;
    const origin =
      root.origin === "automation" || root.origin === "one_off"
        ? root.origin
        : null;
    return {
      category: kind,
      displayName:
        typeof root.displayName === "string" ? root.displayName : null,
      id: root.id,
      kind: root.kind as MessagingEventKind,
      occurredAt: root.occurredAt,
      origin,
      reason: typeof root.reason === "string" ? root.reason : null,
      templateName:
        typeof root.templateName === "string" ? root.templateName : null
    };
  });
}

export function parseMessagingAudience(
  input: unknown
): MessagingAudienceMember[] | null {
  return all(input, (item) => {
    const root = record(item);
    const profileId = root ? uuid(root.profileId) : null;
    return root &&
      profileId &&
      typeof root.displayName === "string" &&
      typeof root.marketingConsent === "boolean" &&
      typeof root.pushConsent === "boolean" &&
      typeof root.pushMarketingConsent === "boolean" &&
      typeof root.whatsappConsent === "boolean"
      ? {
          displayName: root.displayName,
          marketingConsent: root.marketingConsent,
          profileId,
          pushConsent: root.pushConsent,
          pushMarketingConsent: root.pushMarketingConsent,
          whatsappConsent: root.whatsappConsent
        }
      : null;
  });
}

export function parseConnectWhatsappRequest(
  input: unknown
): ConnectWhatsappRequest | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(
      root,
      ["accessToken", "phoneNumberId", "wabaId"],
      ["displayPhone"]
    )
  ) {
    return null;
  }
  const accessToken = text(root.accessToken, 1000);
  const phoneNumberId = text(root.phoneNumberId, 30);
  const wabaId = text(root.wabaId, 30);
  const displayPhone =
    root.displayPhone === undefined || root.displayPhone === null
      ? null
      : text(root.displayPhone, 16);
  if (
    !accessToken ||
    accessToken.trim() !== accessToken ||
    accessToken.length < 20 ||
    !phoneNumberId ||
    !phoneNumberIdPattern.test(phoneNumberId) ||
    !wabaId ||
    !phoneNumberIdPattern.test(wabaId) ||
    (displayPhone !== null && !phonePattern.test(displayPhone))
  ) {
    return null;
  }
  return { accessToken, displayPhone, phoneNumberId, wabaId };
}

export function parseSetSendingRequest(
  input: unknown
): SetSendingRequest | null {
  const root = record(input);
  return root &&
    exactKeys(root, ["enabled"]) &&
    typeof root.enabled === "boolean"
    ? { enabled: root.enabled }
    : null;
}

export function parseSetTemplateCostRequest(
  input: unknown
): SetTemplateCostRequest | null {
  const root = record(input);
  const cost = root?.estimatedCostCents;
  return root &&
    exactKeys(root, ["estimatedCostCents"]) &&
    typeof cost === "number" &&
    Number.isFinite(cost) &&
    cost >= 0 &&
    cost <= 99999 &&
    Math.round(cost * 1000) === cost * 1000
    ? { estimatedCostCents: cost }
    : null;
}

export function parseSaveAutomationRequest(
  input: unknown
): SaveAutomationRequest | null {
  const root = record(input);
  const templateId = root ? uuid(root.templateId) : null;
  return root &&
    exactKeys(root, ["kind", "templateId"]) &&
    isMessagingAutomationKind(root.kind) &&
    templateId
    ? { kind: root.kind, templateId }
    : null;
}

export function parseDecideAutomationRequest(
  input: unknown
): DecideAutomationRequest | null {
  const root = record(input);
  return root &&
    exactKeys(root, ["decision"]) &&
    (root.decision === "approve" ||
      root.decision === "pause" ||
      root.decision === "resume")
    ? { decision: root.decision }
    : null;
}

export function parseProposeOneOffRequest(
  input: unknown
): ProposeOneOffRequest | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, ["commandId", "profileIds", "templateId", "variables"])
  ) {
    return null;
  }
  const commandId = uuid(root.commandId);
  const templateId = uuid(root.templateId);
  const profileIds = Array.isArray(root.profileIds)
    ? root.profileIds.map(uuid)
    : null;
  const variables = Array.isArray(root.variables)
    ? root.variables.map((entry) => text(entry, 200))
    : null;
  if (
    !commandId ||
    !templateId ||
    !profileIds ||
    profileIds.length < 1 ||
    profileIds.length > 200 ||
    profileIds.some((id) => id === null) ||
    new Set(profileIds).size !== profileIds.length ||
    !variables ||
    variables.length > 10 ||
    variables.some((entry) => entry === null)
  ) {
    return null;
  }
  return {
    commandId,
    profileIds: profileIds as string[],
    templateId,
    variables: variables as string[]
  };
}

export function parseDecideOneOffRequest(
  input: unknown
): DecideOneOffRequest | null {
  const root = record(input);
  return root &&
    exactKeys(root, ["decision"]) &&
    (root.decision === "confirm" || root.decision === "cancel")
    ? { decision: root.decision }
    : null;
}

export function parseProposedOneOff(input: unknown): ProposedOneOff | null {
  const root = record(input);
  const batchId = root ? uuid(root.batchId) : null;
  return root && batchId && typeof root.recipients === "number"
    ? { batchId, recipients: root.recipients }
    : null;
}

export function parseDecidedOneOff(input: unknown): DecidedOneOff | null {
  const root = record(input);
  const batchId = root ? uuid(root.batchId) : null;
  return root && batchId && typeof root.changed === "number"
    ? { batchId, changed: root.changed }
    : null;
}

/** Validates what the provider answers, before it reaches the database. */
export function parseProviderTemplates(
  input: unknown
): ProviderTemplate[] | null {
  return all(input, (item) => {
    const root = record(item);
    const name = root ? text(root.name, 100) : null;
    const language = root ? text(root.language, 10) : null;
    const body = root ? text(root.body, 1024) : null;
    const kind = root ? category(root.category) : null;
    const status = root ? templateStatus(root.status) : null;
    return name &&
      templateNamePattern.test(name) &&
      language &&
      languagePattern.test(language) &&
      body &&
      kind &&
      status
      ? { body, category: kind, language, name, status }
      : null;
  });
}

/** The message a worker must send, as the database releases it. */
export type MessageToSend = {
  attempt: number;
  category: MessagingCategory;
  language: string;
  phone: string;
  phoneNumberId: string;
  templateName: string;
  variables: string[];
};

/** A push the worker must deliver to every browser of one person. */
export type PushToSend = {
  attempt: number;
  body: string;
  category: MessagingCategory;
  subscriptions: PushSubscriptionKeys[];
  title: string;
  url: string;
};

export type PushSubscriptionKeys = {
  auth: string;
  endpoint: string;
  p256dh: string;
};

export type BeginSendResult =
  | { action: "blocked"; reason: string }
  | { action: "deferred"; reason: string }
  | { action: "send"; message: MessageToSend }
  | { action: "send_push"; push: PushToSend }
  | { action: "skip" };

export function parseBeginSendResult(input: unknown): BeginSendResult | null {
  const root = record(input);
  if (!root) return null;
  if (root.action === "skip") return { action: "skip" };
  if (typeof root.reason === "string") {
    if (root.action === "blocked") {
      return { action: "blocked", reason: root.reason };
    }
    if (root.action === "deferred") {
      return { action: "deferred", reason: root.reason };
    }
  }
  const kind = category(root.category);
  if (root.action === "send" && root.channel === "web_push") {
    const subscriptions = all(root.subscriptions, parsePushKeys);
    return kind &&
      subscriptions &&
      typeof root.title === "string" &&
      typeof root.body === "string" &&
      typeof root.url === "string" &&
      typeof root.attempt === "number"
      ? {
          action: "send_push",
          push: {
            attempt: root.attempt,
            body: root.body,
            category: kind,
            subscriptions,
            title: root.title,
            url: root.url
          }
        }
      : null;
  }
  const variables = Array.isArray(root.variables)
    ? root.variables.map((entry) => text(entry, 200))
    : null;
  if (
    root.action === "send" &&
    kind &&
    variables &&
    variables.every((entry) => entry !== null) &&
    typeof root.phone === "string" &&
    phonePattern.test(root.phone) &&
    typeof root.phoneNumberId === "string" &&
    typeof root.templateName === "string" &&
    typeof root.language === "string" &&
    typeof root.attempt === "number"
  ) {
    return {
      action: "send",
      message: {
        attempt: root.attempt,
        category: kind,
        language: root.language,
        phone: root.phone,
        phoneNumberId: root.phoneNumberId,
        templateName: root.templateName,
        variables: variables as string[]
      }
    };
  }
  return null;
}

export type SendOutcome = "permanent_failure" | "sent" | "transient_failure";

function parsePushKeys(input: unknown): PushSubscriptionKeys | null {
  const root = record(input);
  return root &&
    typeof root.endpoint === "string" &&
    typeof root.p256dh === "string" &&
    typeof root.auth === "string"
    ? { auth: root.auth, endpoint: root.endpoint, p256dh: root.p256dh }
    : null;
}

/** Push messages the Encargado writes: no Meta approval, 240 characters at most. */
export type SavePushTemplateRequest = {
  body: string;
  category: MessagingCategory;
  name: string;
};

export function parseSavePushTemplateRequest(
  input: unknown
): SavePushTemplateRequest | null {
  const root = record(input);
  const body = root ? text(root.body, 240) : null;
  const name = root ? text(root.name, 100) : null;
  const kind = root ? category(root.category) : null;
  return root &&
    exactKeys(root, ["body", "category", "name"]) &&
    body &&
    body.trim() === body &&
    name &&
    templateNamePattern.test(name) &&
    kind
    ? { body, category: kind, name }
    : null;
}

/** What the browser hands over when the diner allows notifications. */
export type PushSubscriptionRequest = {
  auth: string;
  endpoint: string;
  p256dh: string;
};

const pushEndpointPattern = /^https:\/\/[^\s]{4,1990}$/u;

export function parsePushSubscriptionRequest(
  input: unknown
): PushSubscriptionRequest | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["auth", "endpoint", "p256dh"])) return null;
  const { auth, endpoint, p256dh } = root;
  return typeof auth === "string" &&
    /^[A-Za-z0-9_-]{20,30}$/u.test(auth) &&
    typeof endpoint === "string" &&
    pushEndpointPattern.test(endpoint) &&
    typeof p256dh === "string" &&
    /^[A-Za-z0-9_-]{80,100}$/u.test(p256dh)
    ? { auth, endpoint, p256dh }
    : null;
}

export type PushEndpointRequest = { endpoint: string };

export function parsePushEndpointRequest(
  input: unknown
): PushEndpointRequest | null {
  const root = record(input);
  return root &&
    exactKeys(root, ["endpoint"]) &&
    typeof root.endpoint === "string" &&
    pushEndpointPattern.test(root.endpoint)
    ? { endpoint: root.endpoint }
    : null;
}

export type DinerPushState = { subscribed: boolean };

export function parseDinerPushState(input: unknown): DinerPushState | null {
  const root = record(input);
  return root && typeof root.subscribed === "boolean"
    ? { subscribed: root.subscribed }
    : null;
}

/** Whether this deployment offers push, and the public key the browser needs. */
export type DinerPushConfig = { available: boolean; publicKey: string | null };

export function parseDinerPushConfig(input: unknown): DinerPushConfig | null {
  const root = record(input);
  return root &&
    typeof root.available === "boolean" &&
    (root.publicKey === null || typeof root.publicKey === "string")
    ? { available: root.available, publicKey: root.publicKey }
    : null;
}
