import { createHash, randomBytes } from "node:crypto";

import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../panel/tenant-fetch";
import { isSameOrigin } from "../business-media/same-origin";

export const sessionCookie = "diner_session";
export const bindingCookie = "diner_binding";

const maximumBodyBytes = 4_096;
const thirtyDays = 30 * 24 * 60 * 60;

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function secure(): boolean {
  try {
    return readWebConfig(process.env).environment === "production";
  } catch {
    return true;
  }
}

/** HttpOnly, Lax and scoped to the restaurant host (no Domain attribute). */
export function setCookie(
  name: string,
  value: string,
  options: { maxAge: number; path: string }
): string {
  return [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure() ? ["Secure"] : [])
  ].join("; ");
}

export const sessionCookieHeader = (token: string) =>
  setCookie(sessionCookie, token, { maxAge: thirtyDays, path: "/" });
export const clearSessionCookie = () =>
  setCookie(sessionCookie, "", { maxAge: 0, path: "/" });
export const bindingCookieHeader = (binding: string) =>
  setCookie(bindingCookie, binding, { maxAge: 600, path: "/api/diner" });
export const clearBindingCookie = () =>
  setCookie(bindingCookie, "", { maxAge: 0, path: "/api/diner" });

export function newBinding(): { binding: string; bindingHash: string } {
  const binding = randomBytes(32).toString("base64url");
  return {
    binding,
    bindingHash: createHash("sha256").update(binding).digest("hex")
  };
}

/** Only a path on this same host: never a URL, never `//host`. */
export function localPath(value: string | null, fallback = "/"): string {
  return value && /^\/(?![/\\])[\x21-\x7e]{0,199}$/u.test(value)
    ? value
    : fallback;
}

function failure(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Forwards a diner call to the API with the host that names the restaurant and the
 * session cookie as a Bearer token. The browser never sees the token, and nothing
 * here accepts a tenant, an account or an email from the request.
 */
export async function proxyDiner(
  request: Request,
  options: { method: "DELETE" | "GET" | "POST" | "PUT"; path: string }
): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  if (!host) {
    return failure(404, "TENANT_NOT_FOUND", "Local no disponible.");
  }
  if (options.method !== "GET" && !isSameOrigin(request)) {
    return failure(403, "FORBIDDEN_ORIGIN", "Origen no permitido.");
  }
  const token = readCookie(request, sessionCookie);
  if (!token) {
    return failure(401, "DINER_SESSION_INVALID", "Ingresá para continuar.");
  }
  try {
    const body =
      options.method === "GET" || options.method === "DELETE"
        ? undefined
        : await request.text();
    if (
      body !== undefined &&
      new TextEncoder().encode(body).byteLength > maximumBodyBytes
    ) {
      return failure(413, "DINER_REQUEST_TOO_LARGE", "Pedido inválido.");
    }
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(`${config.apiUrl}${options.path}`, {
      ...(body === undefined ? {} : { body }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        host
      },
      method: options.method
    });
    const headers = new Headers({ "cache-control": "no-store" });
    const response =
      upstream.status === 204
        ? new Response(null, { headers, status: 204 })
        : new Response(await upstream.text(), {
            headers: {
              ...Object.fromEntries(headers),
              "content-type": "application/json"
            },
            status: upstream.status
          });
    // A session the API no longer accepts must not linger in the browser.
    if (upstream.status === 401) {
      response.headers.append("set-cookie", clearSessionCookie());
    }
    return response;
  } catch {
    return failure(502, "DINER_UNREACHABLE", "No disponible.");
  }
}
