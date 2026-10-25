/**
 * Visits, birthday and personal rewards (T29). The restaurant comes from the host and
 * the diner from the session; no request carries a tenant, an account id or an
 * email, and no response ever does. Rewards hang from the diner's per-restaurant
 * profile; the amount of a discount is always computed in the database.
 */
export type LoyaltyRewardKind = "amount" | "percent";
export type LoyaltyRewardStatus = "available" | "reserved";
export type LoyaltyPaymentMethod =
  | "cash"
  | "credit_card"
  | "debit_card"
  | "other_in_person";

export type LoyaltySettings = {
  birthdayMaxChanges: number;
  birthdayMinAgeDays: number;
  enabled: boolean;
  minSessionMinutes: number;
  minSpendCents: number;
  reservationMinutes: number;
  rewardKind: LoyaltyRewardKind;
  rewardValidDays: number;
  /** Percent is in basis points (1000 = 10%); amount is in cents. */
  rewardValue: number;
  visitsGoal: number;
};

export type DinerBirthday = { changes: number; day: number; month: number };

export type DinerReward = {
  expiresAt: string;
  kind: LoyaltyRewardKind;
  reserveExpiresAt: string | null;
  reservedSessionId: string | null;
  rewardId: string;
  status: LoyaltyRewardStatus;
  value: number;
};

export type DinerLoyaltyView = {
  birthday: DinerBirthday | null;
  enabled: boolean;
  minSpendCents: number;
  /** Visits that still count toward the next reward. */
  progress: number;
  rewardKind: LoyaltyRewardKind;
  rewardValue: number;
  rewards: DinerReward[];
  visits: number;
  visitsGoal: number;
};

export type SaveDinerBirthdayRequest = { day: number; month: number };
export type ReserveRewardRequest = { rewardId: string; sessionId: string };
export type ReleaseRewardRequest = { rewardId: string };
export type ReserveRewardResult = {
  discountCents: number;
  pendingCents: number;
  rewardId: string;
  sessionId: string;
};
export type ReleaseRewardResult = { released: boolean; rewardId: string };

export type SessionReward = {
  discountCents: number;
  displayName: string;
  kind: LoyaltyRewardKind;
  reserveExpiresAt: string | null;
  rewardId: string;
  value: number;
};

export type RedeemRewardRequest = {
  commandId: string;
  method: LoyaltyPaymentMethod;
  rewardId: string;
  tipCents: number;
};

/** `released` is true when the payment failed and the reward went back to the diner. */
export type RedeemRewardResult = {
  discountCents?: number;
  failure?: string;
  pendingCents?: number;
  redeemed: boolean;
  released: boolean;
  rewardId: string;
  sessionId: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const methods: readonly LoyaltyPaymentMethod[] = [
  "cash",
  "credit_card",
  "debit_card",
  "other_in_person"
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

function integer(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function kindOf(value: unknown): LoyaltyRewardKind | null {
  return value === "amount" || value === "percent" ? value : null;
}

const settingsKeys = [
  "birthdayMaxChanges",
  "birthdayMinAgeDays",
  "enabled",
  "minSessionMinutes",
  "minSpendCents",
  "reservationMinutes",
  "rewardKind",
  "rewardValidDays",
  "rewardValue",
  "visitsGoal"
];

/** The settings a manager sends and the ones the database returns share a shape. */
export function parseLoyaltySettings(input: unknown): LoyaltySettings | null {
  const root = record(input);
  if (!root || !exactKeys(root, settingsKeys)) return null;
  const rewardKind = kindOf(root.rewardKind);
  const rewardValue = integer(root.rewardValue, 1, 1_000_000_000);
  const birthdayMaxChanges = integer(root.birthdayMaxChanges, 0, 10);
  const birthdayMinAgeDays = integer(root.birthdayMinAgeDays, 0, 3650);
  const minSessionMinutes = integer(root.minSessionMinutes, 0, 720);
  const minSpendCents = integer(root.minSpendCents, 0, 1_000_000_000);
  const reservationMinutes = integer(root.reservationMinutes, 1, 240);
  const rewardValidDays = integer(root.rewardValidDays, 1, 730);
  const visitsGoal = integer(root.visitsGoal, 1, 50);
  if (
    typeof root.enabled !== "boolean" ||
    !rewardKind ||
    rewardValue === null ||
    (rewardKind === "percent" && rewardValue > 10_000) ||
    birthdayMaxChanges === null ||
    birthdayMinAgeDays === null ||
    minSessionMinutes === null ||
    minSpendCents === null ||
    reservationMinutes === null ||
    rewardValidDays === null ||
    visitsGoal === null
  ) {
    return null;
  }
  return {
    birthdayMaxChanges,
    birthdayMinAgeDays,
    enabled: root.enabled,
    minSessionMinutes,
    minSpendCents,
    reservationMinutes,
    rewardKind,
    rewardValidDays,
    rewardValue,
    visitsGoal
  };
}

export function parseSaveDinerBirthdayRequest(
  input: unknown
): SaveDinerBirthdayRequest | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["day", "month"])) return null;
  const month = integer(root.month, 1, 12);
  const day = integer(root.day, 1, 31);
  return month === null || day === null ? null : { day, month };
}

export function parseReserveRewardRequest(
  input: unknown
): ReserveRewardRequest | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["rewardId", "sessionId"])) return null;
  const rewardId = uuid(root.rewardId);
  const sessionId = uuid(root.sessionId);
  return rewardId && sessionId ? { rewardId, sessionId } : null;
}

export function parseReleaseRewardRequest(
  input: unknown
): ReleaseRewardRequest | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["rewardId"])) return null;
  const rewardId = uuid(root.rewardId);
  return rewardId ? { rewardId } : null;
}

export function parseRedeemRewardRequest(
  input: unknown
): RedeemRewardRequest | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["commandId", "method", "rewardId"], ["tipCents"])) {
    return null;
  }
  const commandId = uuid(root.commandId);
  const rewardId = uuid(root.rewardId);
  const method = methods.find((candidate) => candidate === root.method);
  const tipCents = root.tipCents === undefined ? 0 : integer(root.tipCents, 0, 1_000_000_000);
  return commandId && rewardId && method && tipCents !== null
    ? { commandId, method, rewardId, tipCents }
    : null;
}

function birthday(input: unknown): DinerBirthday | null | undefined {
  if (input === null) return null;
  const root = record(input);
  if (!root || !exactKeys(root, ["changes", "day", "month"])) return undefined;
  const changes = integer(root.changes, 0, 10_000);
  const day = integer(root.day, 1, 31);
  const month = integer(root.month, 1, 12);
  return changes === null || day === null || month === null
    ? undefined
    : { changes, day, month };
}

function reward(input: unknown): DinerReward | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, [
      "expiresAt",
      "kind",
      "reserveExpiresAt",
      "reservedSessionId",
      "rewardId",
      "status",
      "value"
    ])
  ) {
    return null;
  }
  const kind = kindOf(root.kind);
  const value = integer(root.value, 1, 1_000_000_000);
  const rewardId = uuid(root.rewardId);
  const status =
    root.status === "available" || root.status === "reserved"
      ? root.status
      : null;
  const reservedSessionId =
    root.reservedSessionId === null ? null : uuid(root.reservedSessionId);
  if (
    !kind ||
    value === null ||
    !rewardId ||
    !status ||
    typeof root.expiresAt !== "string" ||
    (root.reserveExpiresAt !== null &&
      typeof root.reserveExpiresAt !== "string") ||
    (root.reservedSessionId !== null && !reservedSessionId)
  ) {
    return null;
  }
  return {
    expiresAt: root.expiresAt,
    kind,
    reserveExpiresAt: root.reserveExpiresAt as string | null,
    reservedSessionId,
    rewardId,
    status,
    value
  };
}

export function parseDinerLoyaltyView(input: unknown): DinerLoyaltyView | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, [
      "birthday",
      "enabled",
      "minSpendCents",
      "progress",
      "rewardKind",
      "rewardValue",
      "rewards",
      "visits",
      "visitsGoal"
    ])
  ) {
    return null;
  }
  const parsedBirthday = birthday(root.birthday);
  const kind = kindOf(root.rewardKind);
  const minSpendCents = integer(root.minSpendCents, 0, 1_000_000_000);
  const progress = integer(root.progress, 0, 1_000_000);
  const rewardValue = integer(root.rewardValue, 1, 1_000_000_000);
  const visits = integer(root.visits, 0, 1_000_000);
  const visitsGoal = integer(root.visitsGoal, 1, 50);
  if (
    parsedBirthday === undefined ||
    typeof root.enabled !== "boolean" ||
    !kind ||
    minSpendCents === null ||
    progress === null ||
    rewardValue === null ||
    visits === null ||
    visitsGoal === null ||
    !Array.isArray(root.rewards)
  ) {
    return null;
  }
  const rewards: DinerReward[] = [];
  for (const item of root.rewards) {
    const parsed = reward(item);
    if (!parsed) return null;
    rewards.push(parsed);
  }
  return {
    birthday: parsedBirthday,
    enabled: root.enabled,
    minSpendCents,
    progress,
    rewardKind: kind,
    rewardValue,
    rewards,
    visits,
    visitsGoal
  };
}

export function parseDinerBirthday(input: unknown): DinerBirthday | null {
  const parsed = birthday(input);
  return parsed ?? null;
}

export function parseReserveRewardResult(
  input: unknown
): ReserveRewardResult | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(root, ["discountCents", "pendingCents", "rewardId", "sessionId"])
  ) {
    return null;
  }
  const discountCents = integer(root.discountCents, 1, 1_000_000_000);
  const pendingCents = integer(root.pendingCents, 0, 1_000_000_000);
  const rewardId = uuid(root.rewardId);
  const sessionId = uuid(root.sessionId);
  return discountCents !== null && pendingCents !== null && rewardId && sessionId
    ? { discountCents, pendingCents, rewardId, sessionId }
    : null;
}

export function parseReleaseRewardResult(
  input: unknown
): ReleaseRewardResult | null {
  const root = record(input);
  if (!root || !exactKeys(root, ["released", "rewardId"])) return null;
  const rewardId = uuid(root.rewardId);
  return rewardId && typeof root.released === "boolean"
    ? { released: root.released, rewardId }
    : null;
}

export function parseSessionRewards(input: unknown): SessionReward[] | null {
  if (!Array.isArray(input)) return null;
  const rewards: SessionReward[] = [];
  for (const item of input) {
    const root = record(item);
    if (
      !root ||
      !exactKeys(root, [
        "discountCents",
        "displayName",
        "kind",
        "reserveExpiresAt",
        "rewardId",
        "value"
      ])
    ) {
      return null;
    }
    const discountCents = integer(root.discountCents, 0, 1_000_000_000);
    const kind = kindOf(root.kind);
    const rewardId = uuid(root.rewardId);
    const value = integer(root.value, 1, 1_000_000_000);
    if (
      discountCents === null ||
      !kind ||
      !rewardId ||
      value === null ||
      typeof root.displayName !== "string" ||
      (root.reserveExpiresAt !== null &&
        typeof root.reserveExpiresAt !== "string")
    ) {
      return null;
    }
    rewards.push({
      discountCents,
      displayName: root.displayName,
      kind,
      reserveExpiresAt: root.reserveExpiresAt as string | null,
      rewardId,
      value
    });
  }
  return rewards;
}

export function parseRedeemRewardResult(
  input: unknown
): RedeemRewardResult | null {
  const root = record(input);
  if (
    !root ||
    !exactKeys(
      root,
      ["redeemed", "released", "rewardId", "sessionId"],
      ["discountCents", "failure", "pendingCents"]
    )
  ) {
    return null;
  }
  const rewardId = uuid(root.rewardId);
  const sessionId = uuid(root.sessionId);
  if (
    !rewardId ||
    !sessionId ||
    typeof root.redeemed !== "boolean" ||
    typeof root.released !== "boolean" ||
    (root.failure !== undefined && typeof root.failure !== "string")
  ) {
    return null;
  }
  const discountCents =
    root.discountCents === undefined
      ? undefined
      : integer(root.discountCents, 1, 1_000_000_000);
  const pendingCents =
    root.pendingCents === undefined
      ? undefined
      : integer(root.pendingCents, 0, 1_000_000_000);
  if (discountCents === null || pendingCents === null) return null;
  return {
    ...(discountCents === undefined ? {} : { discountCents }),
    ...(root.failure === undefined ? {} : { failure: root.failure as string }),
    ...(pendingCents === undefined ? {} : { pendingCents }),
    redeemed: root.redeemed,
    released: root.released,
    rewardId,
    sessionId
  };
}
