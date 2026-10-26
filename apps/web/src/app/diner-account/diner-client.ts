import {
  parseDinerExport,
  parseDinerProfileView,
  type DinerConsentKind,
  type DinerExport,
  type DinerProfileView
} from "@platform/contracts";

export type DinerOutcome<T> =
  | { ok: true; value: T }
  | { code: string; message: string; ok: false; status: number };

const unreachable = {
  code: "DINER_UNREACHABLE",
  message: "No pudimos conectar. Probá de nuevo.",
  ok: false,
  status: 0
} as const;

const jsonHeaders = { "content-type": "application/json" };

async function failure(response: Response) {
  let code = "DINER_ERROR";
  let message = "No pudimos completar la acción. Probá de nuevo.";
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.message === "string") message = body.error.message;
  } catch {
    // Keep the generic message.
  }
  return { code, message, ok: false, status: response.status } as const;
}

async function view(
  request: Promise<Response>
): Promise<DinerOutcome<DinerProfileView>> {
  try {
    const response = await request;
    if (!response.ok) return await failure(response);
    const parsed = parseDinerProfileView(
      ((await response.json()) as { data?: unknown }).data
    );
    return parsed
      ? { ok: true, value: parsed }
      : { ...unreachable, code: "DINER_RESPONSE_INVALID" };
  } catch {
    return unreachable;
  }
}

/** Whether this restaurant's menu offers the optional Google login at all. */
export async function loadAvailability(): Promise<boolean> {
  try {
    const response = await fetch("/api/diner/availability", {
      cache: "no-store"
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { data?: { available?: unknown } };
    return body.data?.available === true;
  } catch {
    return false;
  }
}

export function loadMe() {
  return view(fetch("/api/diner/me", { cache: "no-store" }));
}

export function saveProfile(input: {
  displayName: string;
  whatsappPhone: string | null;
}) {
  return view(
    fetch("/api/diner/profile", {
      body: JSON.stringify(input),
      headers: jsonHeaders,
      method: "PUT"
    })
  );
}

export function setConsent(input: {
  granted: boolean;
  kind: DinerConsentKind;
  textVersion: number;
}) {
  return view(
    fetch("/api/diner/consents", {
      body: JSON.stringify({
        action: input.granted ? "granted" : "revoked",
        commandId: crypto.randomUUID(),
        kind: input.kind,
        source: "profile",
        textVersion: input.textVersion
      }),
      headers: jsonHeaders,
      method: "POST"
    })
  );
}

/** Best effort: joins the open table session of this QR if there is one. */
export async function linkToSession(token: string): Promise<boolean> {
  try {
    const response = await fetch("/api/diner/session-links", {
      body: JSON.stringify({ token }),
      headers: jsonHeaders,
      method: "POST"
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { data?: { linked?: unknown } };
    return body.data?.linked === true;
  } catch {
    return false;
  }
}

export async function loadExport(): Promise<DinerOutcome<DinerExport>> {
  try {
    const response = await fetch("/api/diner/export", { cache: "no-store" });
    if (!response.ok) return await failure(response);
    const parsed = parseDinerExport(
      ((await response.json()) as { data?: unknown }).data
    );
    return parsed
      ? { ok: true, value: parsed }
      : { ...unreachable, code: "DINER_RESPONSE_INVALID" };
  } catch {
    return unreachable;
  }
}

export async function deleteAccount(): Promise<DinerOutcome<true>> {
  try {
    const response = await fetch("/api/diner/account", { method: "DELETE" });
    return response.status === 204
      ? { ok: true, value: true }
      : await failure(response);
  } catch {
    return unreachable;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/diner/logout", { method: "POST" });
  } catch {
    // The cookie is cleared by the server response; nothing else to do.
  }
}

/** A path on this same host to come back to; anything else becomes the root. */
export function backPath(value: string | null | undefined): string {
  return value && /^\/(?![/\\])[\x21-\x7e]{0,199}$/u.test(value) ? value : "/";
}
