import { readWebConfig } from "@platform/config";
import {
  parseBusinessProfileDraft,
  type BusinessProfileDraft
} from "@platform/contracts";

import { createAuthServerClient } from "../../auth/supabase-server";

export type SavedBusinessProfileDraft = BusinessProfileDraft & {
  revision: number;
  updatedAt: string;
};

export function parseBusinessProfileResponse(
  input: unknown
): SavedBusinessProfileDraft | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Respuesta de perfil inválida.");
  }
  const root = input as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !("data" in root)) {
    throw new Error("Respuesta de perfil inválida.");
  }
  if (root.data === null) return null;
  if (!root.data || typeof root.data !== "object" || Array.isArray(root.data)) {
    throw new Error("Respuesta de perfil inválida.");
  }
  const { revision, updatedAt, ...draft } = root.data as Record<
    string,
    unknown
  >;
  const parsed = parseBusinessProfileDraft(draft);
  if (
    !parsed ||
    !Number.isSafeInteger(revision) ||
    (revision as number) < 1 ||
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    throw new Error("Respuesta de perfil inválida.");
  }
  return { ...parsed, revision: revision as number, updatedAt };
}

export async function loadBusinessProfileDraft(
  host: string
): Promise<
  | { data: SavedBusinessProfileDraft | null; status: "ready" }
  | { status: "unavailable" }
> {
  const supabase = await createAuthServerClient();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken || !host) return { status: "unavailable" };
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(
      `${config.apiUrl}/v1/tenant/business-profile`,
      {
        cache: "no-store",
        headers: { authorization: `Bearer ${accessToken}`, host }
      }
    );
    if (!response.ok) return { status: "unavailable" };
    return {
      data: parseBusinessProfileResponse(await response.json()),
      status: "ready"
    };
  } catch {
    return { status: "unavailable" };
  }
}
