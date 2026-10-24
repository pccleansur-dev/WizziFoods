import { staffRoleLabels, type StaffRole } from "./staff-access.js";

/**
 * Salon sectors (T13) are assigned to waiters only. Kitchen and bar staff are
 * bound to their T11 production sector by role.
 */
export const TEAM_LIMITS = {
  displayNameMax: 120,
  pinLength: 6,
  sectorsPerMember: 50,
  usernameMax: 64,
  usernameMin: 3
} as const;

export type TeamIssueCode =
  | "INVALID_FIELD"
  | "INVALID_STRUCTURE"
  | "UNKNOWN_FIELD";

export type TeamIssue = { code: TeamIssueCode; message: string; path: string };

export type TeamMember = {
  createdAt: string;
  displayName: string;
  id: string;
  isActive: boolean;
  role: StaffRole;
  sectorIds: string[];
  username: string;
};

export type TeamMemberCreate = {
  displayName: string;
  pin: string;
  role: StaffRole;
  sectorIds: string[];
  username: string;
};

export type TeamMemberUpdate = {
  displayName: string;
  role: StaffRole;
  sectorIds: string[];
};

export type TeamParseResult<T> =
  { issues: TeamIssue[]; ok: false } | { ok: true; value: T };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const usernamePattern = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/u;
const pinPattern = /^\d{6}$/u;

export function isTeamUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRole(value: unknown): value is StaffRole {
  return typeof value === "string" && Object.hasOwn(staffRoleLabels, value);
}

function hasControl(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function checkKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  issues: TeamIssue[]
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      issues.push({
        code: "UNKNOWN_FIELD",
        message: "Ese campo no está permitido.",
        path: key
      });
    }
  }
}

function checkDisplayName(value: unknown, issues: TeamIssue[]): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > TEAM_LIMITS.displayNameMax ||
    hasControl(value)
  ) {
    issues.push({
      code: "INVALID_FIELD",
      message: "El nombre debe tener entre 1 y 120 caracteres.",
      path: "displayName"
    });
    return "";
  }
  return value;
}

function checkRole(value: unknown, issues: TeamIssue[]): StaffRole {
  if (!isRole(value)) {
    issues.push({
      code: "INVALID_FIELD",
      message: "Elegí un rol válido.",
      path: "role"
    });
    return "waiter";
  }
  return value;
}

function checkSectors(
  value: unknown,
  role: StaffRole,
  issues: TeamIssue[]
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > TEAM_LIMITS.sectorsPerMember ||
    !value.every(isTeamUuid) ||
    new Set(value).size !== value.length
  ) {
    issues.push({
      code: "INVALID_FIELD",
      message: "Los sectores no son válidos.",
      path: "sectorIds"
    });
    return [];
  }
  if (value.length > 0 && role !== "waiter") {
    issues.push({
      code: "INVALID_FIELD",
      message: "Solo el Mozo recibe sectores del salón.",
      path: "sectorIds"
    });
  }
  return [...(value as string[])];
}

function checkPin(value: unknown, issues: TeamIssue[]): string {
  if (typeof value !== "string" || !pinPattern.test(value)) {
    issues.push({
      code: "INVALID_FIELD",
      message: "El PIN debe tener exactamente seis dígitos.",
      path: "pin"
    });
    return "";
  }
  return value;
}

function structure(): TeamParseResult<never> {
  return {
    issues: [
      {
        code: "INVALID_STRUCTURE",
        message: "El pedido no tiene el formato esperado.",
        path: ""
      }
    ],
    ok: false
  };
}

export function parseTeamMemberCreate(
  input: unknown
): TeamParseResult<TeamMemberCreate> {
  const root = record(input);
  if (!root) return structure();
  const issues: TeamIssue[] = [];
  checkKeys(
    root,
    ["displayName", "pin", "role", "sectorIds", "username"],
    issues
  );
  const username = root.username;
  if (
    typeof username !== "string" ||
    username.length < TEAM_LIMITS.usernameMin ||
    username.length > TEAM_LIMITS.usernameMax ||
    !usernamePattern.test(username)
  ) {
    issues.push({
      code: "INVALID_FIELD",
      message:
        "El usuario usa minúsculas, números, punto, guion o guion bajo (3 a 64).",
      path: "username"
    });
  }
  const displayName = checkDisplayName(root.displayName, issues);
  const role = checkRole(root.role, issues);
  const sectorIds = checkSectors(root.sectorIds, role, issues);
  const pin = checkPin(root.pin, issues);
  if (issues.length > 0) return { issues, ok: false };
  return {
    ok: true,
    value: { displayName, pin, role, sectorIds, username: username as string }
  };
}

export function parseTeamMemberUpdate(
  input: unknown
): TeamParseResult<TeamMemberUpdate> {
  const root = record(input);
  if (!root) return structure();
  const issues: TeamIssue[] = [];
  checkKeys(root, ["displayName", "role", "sectorIds"], issues);
  const displayName = checkDisplayName(root.displayName, issues);
  const role = checkRole(root.role, issues);
  const sectorIds = checkSectors(root.sectorIds, role, issues);
  if (issues.length > 0) return { issues, ok: false };
  return { ok: true, value: { displayName, role, sectorIds } };
}

export function parseTeamMemberActivation(
  input: unknown
): TeamParseResult<{ active: boolean }> {
  const root = record(input);
  if (!root) return structure();
  const issues: TeamIssue[] = [];
  checkKeys(root, ["active"], issues);
  if (typeof root.active !== "boolean") {
    issues.push({
      code: "INVALID_FIELD",
      message: "Indicá si el empleado queda activo.",
      path: "active"
    });
  }
  if (issues.length > 0) return { issues, ok: false };
  return { ok: true, value: { active: root.active as boolean } };
}

export function parseTeamPinReset(
  input: unknown
): TeamParseResult<{ pin: string }> {
  const root = record(input);
  if (!root) return structure();
  const issues: TeamIssue[] = [];
  checkKeys(root, ["pin"], issues);
  const pin = checkPin(root.pin, issues);
  if (issues.length > 0) return { issues, ok: false };
  return { ok: true, value: { pin } };
}

/** Validates what the database returns before it reaches an API response. */
export function parseTeamMember(input: unknown): TeamMember | null {
  const root = record(input);
  if (
    !root ||
    Object.keys(root).sort().join() !==
      "createdAt,displayName,id,isActive,role,sectorIds,username" ||
    !isTeamUuid(root.id) ||
    typeof root.username !== "string" ||
    !usernamePattern.test(root.username) ||
    typeof root.displayName !== "string" ||
    typeof root.isActive !== "boolean" ||
    !isRole(root.role) ||
    typeof root.createdAt !== "string" ||
    !Array.isArray(root.sectorIds) ||
    !root.sectorIds.every(isTeamUuid)
  ) {
    return null;
  }
  return {
    createdAt: root.createdAt,
    displayName: root.displayName,
    id: root.id,
    isActive: root.isActive,
    role: root.role,
    sectorIds: [...(root.sectorIds as string[])],
    username: root.username
  };
}
