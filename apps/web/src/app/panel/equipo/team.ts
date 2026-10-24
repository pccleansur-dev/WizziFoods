import {
  parseTeamMember,
  type TeamIssue,
  type TeamMember
} from "@platform/contracts";

import { adminApi, dataOf } from "../admin-api";

export type TeamActionState = {
  issues: TeamIssue[];
  members: TeamMember[] | null;
  message: string;
  status: "error" | "idle" | "invalid" | "saved";
};

export type TeamCommand =
  | {
      displayName: string;
      pin: string;
      role: string;
      sectorIds: string[];
      type: "create";
      username: string;
    }
  | {
      displayName: string;
      id: string;
      role: string;
      sectorIds: string[];
      type: "update";
    }
  | { active: boolean; id: string; type: "active" }
  | { id: string; pin: string; type: "pin" };

export function parseTeamList(body: unknown): TeamMember[] {
  const data = dataOf(body);
  if (!Array.isArray(data)) throw new Error("Respuesta del equipo inválida.");
  return data.map((value) => {
    const member = parseTeamMember(value);
    if (!member) throw new Error("Respuesta del equipo inválida.");
    return member;
  });
}

export async function loadTeam(): Promise<
  | {
      members: TeamMember[];
      sectors: { id: string; name: string }[];
      status: "ready";
    }
  | { status: "unavailable" }
> {
  try {
    const [team, plan] = await Promise.all([
      adminApi("/v1/tenant/team"),
      adminApi("/v1/tenant/floor-plan")
    ]);
    if (!team.ok || !plan.ok) return { status: "unavailable" };
    const planData = dataOf(plan.body) as {
      plan?: { sectors?: { id: unknown; name: unknown }[] };
    };
    const sectors = (planData.plan?.sectors ?? [])
      .filter(
        (sector): sector is { id: string; name: string } =>
          typeof sector.id === "string" && typeof sector.name === "string"
      )
      .map(({ id, name }) => ({ id, name }));
    return { members: parseTeamList(team.body), sectors, status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}
