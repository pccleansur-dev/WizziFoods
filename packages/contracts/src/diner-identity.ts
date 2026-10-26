/**
 * Optional diner accounts (T28). The platform knows the diner through Google; each
 * restaurant only knows the profile the diner created with it. No request carries a
 * tenant, a location, an account id or an email, and no response ever does: the
 * restaurant comes from the host and the account from the diner session.
 */
export type DinerConsentKind = "marketing" | "whatsapp_verified";
export type DinerConsentAction = "granted" | "revoked";
/** `anonymization` is written by the server and can never be requested. */
export type DinerConsentSource = "menu" | "profile";

export type SaveDinerProfileRequest = {
  displayName: string;
  whatsappPhone: string | null;
};

export type DinerConsentRequest = {
  action: DinerConsentAction;
  commandId: string;
  kind: DinerConsentKind;
  source: DinerConsentSource;
  textVersion: number;
};

export type StartDinerLoginRequest = {
  /** SHA-256 (hex) of a secret the restaurant host keeps in an HttpOnly cookie. */
  bindingHash: string;
  /** Where to land after the login: always a path on the same restaurant host. */
  returnPath: string;
};

export type RedeemDinerLoginRequest = {
  binding: string;
  code: string;
};

export type DinerSessionLinkRequest = { token: string };
export type DinerSessionLinkResult = { linked: boolean };

export type DinerConsentState = {
  at: string | null;
  granted: boolean;
  textVersion: number | null;
};

export type DinerProfile = {
  consents: Record<DinerConsentKind, DinerConsentState>;
  displayName: string;
  profileId: string;
  whatsappPhone: string | null;
};

export type DinerConsentText = {
  body: string;
  kind: DinerConsentKind;
  version: number;
};

export type DinerProfileView = {
  profile: DinerProfile | null;
  texts: DinerConsentText[];
};

export type DinerExport = {
  account: { createdAt: string; email: string };
  restaurants: Array<{
    consents: Array<{
      action: DinerConsentAction;
      at: string;
      kind: DinerConsentKind;
      source: string;
      textVersion: number;
    }>;
    createdAt: string;
    displayName: string;
    restaurant: string;
    sessions: Array<{ linkedAt: string; sessionId: string }>;
    slug: string;
    whatsappPhone: string | null;
  }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hexPattern = /^[0-9a-f]{64}$/u;
const secretPattern = /^[A-Za-z0-9_-]{43}$/u;
const phonePattern = /^\+[1-9][0-9]{7,14}$/u;
const kinds: readonly DinerConsentKind[] = ["marketing", "whatsapp_verified"];
const maximumNameLength = 80;
const maximumReturnPath = 200;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = []
) {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function kindOf(value: unknown): DinerConsentKind | null {
  return kinds.find((candidate) => candidate === value) ?? null;
}

function name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 &&
    trimmed.length <= maximumNameLength &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)
    ? trimmed
    : null;
}

export function parseSaveDinerProfileRequest(
  input: unknown
): SaveDinerProfileRequest | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["displayName"], ["whatsappPhone"])) {
    return null;
  }
  const displayName = name(root.displayName);
  const phone = root.whatsappPhone ?? null;
  if (
    !displayName ||
    (phone !== null && (typeof phone !== "string" || !phonePattern.test(phone)))
  ) {
    return null;
  }
  return { displayName, whatsappPhone: phone };
}

export function parseDinerConsentRequest(
  input: unknown
): DinerConsentRequest | null {
  const root = record(input);
  if (
    !root ||
    !hasOnlyKeys(root, ["action", "commandId", "kind", "source", "textVersion"])
  ) {
    return null;
  }
  const kind = kindOf(root.kind);
  const action =
    root.action === "granted" || root.action === "revoked" ? root.action : null;
  const source =
    root.source === "menu" || root.source === "profile" ? root.source : null;
  if (
    !kind ||
    !action ||
    !source ||
    typeof root.commandId !== "string" ||
    !uuidPattern.test(root.commandId) ||
    typeof root.textVersion !== "number" ||
    !Number.isInteger(root.textVersion) ||
    root.textVersion < 1
  ) {
    return null;
  }
  return {
    action,
    commandId: root.commandId,
    kind,
    source,
    textVersion: root.textVersion
  };
}

export function parseStartDinerLoginRequest(
  input: unknown
): StartDinerLoginRequest | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["bindingHash", "returnPath"])) return null;
  const { bindingHash, returnPath } = root;
  if (
    typeof bindingHash !== "string" ||
    !hexPattern.test(bindingHash) ||
    typeof returnPath !== "string" ||
    returnPath.length > maximumReturnPath ||
    !/^\/(?![/\\])[\x21-\x7e]*$/u.test(returnPath)
  ) {
    return null;
  }
  return { bindingHash, returnPath };
}

export function parseRedeemDinerLoginRequest(
  input: unknown
): RedeemDinerLoginRequest | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["binding", "code"])) return null;
  return typeof root.binding === "string" &&
    secretPattern.test(root.binding) &&
    typeof root.code === "string" &&
    secretPattern.test(root.code)
    ? { binding: root.binding, code: root.code }
    : null;
}

export function parseDinerSessionLinkRequest(
  input: unknown
): DinerSessionLinkRequest | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["token"])) return null;
  return typeof root.token === "string" && hexPattern.test(root.token)
    ? { token: root.token }
    : null;
}

export function parseDinerSessionLinkResult(
  input: unknown
): DinerSessionLinkResult | null {
  const root = record(input);
  return root &&
    hasOnlyKeys(root, ["linked"]) &&
    typeof root.linked === "boolean"
    ? { linked: root.linked }
    : null;
}

function consentState(input: unknown): DinerConsentState | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["at", "granted", "textVersion"]))
    return null;
  const { at, granted, textVersion } = root;
  return (at === null || typeof at === "string") &&
    typeof granted === "boolean" &&
    (textVersion === null ||
      (typeof textVersion === "number" && Number.isInteger(textVersion)))
    ? { at, granted, textVersion }
    : null;
}

function profile(input: unknown): DinerProfile | null {
  const root = record(input);
  if (
    !root ||
    !hasOnlyKeys(root, [
      "consents",
      "displayName",
      "profileId",
      "whatsappPhone"
    ])
  ) {
    return null;
  }
  const consents = record(root.consents);
  if (!consents || !hasOnlyKeys(consents, [...kinds])) return null;
  const marketing = consentState(consents.marketing);
  const whatsapp = consentState(consents.whatsapp_verified);
  if (
    !marketing ||
    !whatsapp ||
    typeof root.displayName !== "string" ||
    typeof root.profileId !== "string" ||
    !uuidPattern.test(root.profileId) ||
    (root.whatsappPhone !== null && typeof root.whatsappPhone !== "string")
  ) {
    return null;
  }
  return {
    consents: { marketing, whatsapp_verified: whatsapp },
    displayName: root.displayName,
    profileId: root.profileId,
    whatsappPhone: root.whatsappPhone
  };
}

function text(input: unknown): DinerConsentText | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["body", "kind", "version"])) return null;
  const kind = kindOf(root.kind);
  return kind &&
    typeof root.body === "string" &&
    typeof root.version === "number" &&
    Number.isInteger(root.version)
    ? { body: root.body, kind, version: root.version }
    : null;
}

export function parseDinerProfileView(input: unknown): DinerProfileView | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["profile", "texts"])) return null;
  if (!Array.isArray(root.texts)) return null;
  const texts: DinerConsentText[] = [];
  for (const item of root.texts) {
    const parsed = text(item);
    if (!parsed) return null;
    texts.push(parsed);
  }
  if (root.profile === null) return { profile: null, texts };
  const parsedProfile = profile(root.profile);
  return parsedProfile ? { profile: parsedProfile, texts } : null;
}

export function parseDinerExport(input: unknown): DinerExport | null {
  const root = record(input);
  if (!root || !hasOnlyKeys(root, ["account", "restaurants"])) return null;
  const account = record(root.account);
  if (
    !account ||
    !hasOnlyKeys(account, ["createdAt", "email"]) ||
    typeof account.createdAt !== "string" ||
    typeof account.email !== "string" ||
    !Array.isArray(root.restaurants)
  ) {
    return null;
  }
  return input as DinerExport;
}
