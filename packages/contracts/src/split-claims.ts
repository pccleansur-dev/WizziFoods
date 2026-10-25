/**
 * Claiming a share of a split from the diner's phone. The diner proves who they are
 * with a table token (which table) and a device secret (which phone): the secret
 * never leaves the phone except to be hashed here, so only that phone can release
 * the shares it reserved.
 */

export type DinerShare = {
  amountCents: number;
  /** Who reserved it, when someone did. */
  claimedBy: string | null;
  items: string[];
  /** Reserved by this very device. */
  mine: boolean;
  position: number;
  status: "cancelled" | "claimed" | "open" | "paid";
};

export type DinerSplitView = {
  pendingCents: number;
  split: {
    kind: "equal" | "items";
    shares: DinerShare[];
    splitId: string;
  } | null;
};

export type DinerSplitTarget = { secret: string; token: string };
export type ClaimShareRequest = DinerSplitTarget & {
  label: string;
  position: number;
};
export type ReleaseShareRequest = DinerSplitTarget & { position: number };

const tokenPattern = /^[0-9a-f]{64}$/u;
const secretPattern = /^[0-9A-Za-z_-]{43}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function target(root: Record<string, unknown>): DinerSplitTarget | null {
  return typeof root.token === "string" &&
    tokenPattern.test(root.token) &&
    typeof root.secret === "string" &&
    secretPattern.test(root.secret)
    ? { secret: root.secret, token: root.token }
    : null;
}

function position(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 20
    ? value
    : null;
}

export function parseDinerSplitTarget(input: unknown): DinerSplitTarget | null {
  const root = record(input);
  return root && exact(root, ["secret", "token"]) ? target(root) : null;
}

export function parseClaimShareRequest(
  input: unknown
): ClaimShareRequest | null {
  const root = record(input);
  if (!root || !exact(root, ["label", "position", "secret", "token"])) {
    return null;
  }
  const base = target(root);
  const at = position(root.position);
  const label = typeof root.label === "string" ? root.label.trim() : "";
  return base && at !== null && label.length >= 1 && label.length <= 40
    ? { ...base, label, position: at }
    : null;
}

export function parseReleaseShareRequest(
  input: unknown
): ReleaseShareRequest | null {
  const root = record(input);
  if (!root || !exact(root, ["position", "secret", "token"])) return null;
  const base = target(root);
  const at = position(root.position);
  return base && at !== null ? { ...base, position: at } : null;
}

function titles(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  return value.every(
    (entry) => typeof entry === "string" && entry.length <= 200
  )
    ? (value as string[])
    : null;
}

export function parseDinerSplitView(input: unknown): DinerSplitView | null {
  const root = record(input);
  if (!root || !exact(root, ["pendingCents", "split"])) return null;
  const pending = root.pendingCents;
  if (typeof pending !== "number" || !Number.isSafeInteger(pending)) {
    return null;
  }
  if (root.split === null) return { pendingCents: pending, split: null };
  const split = record(root.split);
  if (
    !split ||
    !exact(split, ["kind", "shares", "splitId"]) ||
    (split.kind !== "equal" && split.kind !== "items") ||
    typeof split.splitId !== "string" ||
    !uuidPattern.test(split.splitId) ||
    !Array.isArray(split.shares) ||
    split.shares.length < 2 ||
    split.shares.length > 20
  ) {
    return null;
  }
  const shares: DinerShare[] = [];
  for (const [index, candidate] of split.shares.entries()) {
    const share = record(candidate);
    if (
      !share ||
      !exact(share, [
        "amountCents",
        "claimedBy",
        "items",
        "mine",
        "position",
        "status"
      ])
    ) {
      return null;
    }
    const items = titles(share.items);
    const status = ["cancelled", "claimed", "open", "paid"].includes(
      String(share.status)
    )
      ? (share.status as DinerShare["status"])
      : null;
    if (
      typeof share.amountCents !== "number" ||
      !Number.isSafeInteger(share.amountCents) ||
      share.amountCents <= 0 ||
      !items ||
      !status ||
      typeof share.mine !== "boolean" ||
      share.position !== index + 1 ||
      !(
        share.claimedBy === null ||
        (typeof share.claimedBy === "string" &&
          share.claimedBy.length >= 1 &&
          share.claimedBy.length <= 40)
      )
    ) {
      return null;
    }
    shares.push({
      amountCents: share.amountCents,
      claimedBy: share.claimedBy as string | null,
      items,
      mine: share.mine,
      position: index + 1,
      status
    });
  }
  return {
    pendingCents: pending,
    split: { kind: split.kind, shares, splitId: split.splitId }
  };
}
