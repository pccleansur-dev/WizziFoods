import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../../panel/tenant-fetch";
import {
  bindingCookieHeader,
  isOwnSite,
  localPath,
  newBinding
} from "../diner-proxy";

/**
 * Starts the optional Google login. The browser keeps a random secret in an HttpOnly
 * cookie and only its hash travels to Google and back, so a login link cannot be
 * completed by anyone but the browser that started it. If anything fails the diner
 * simply lands back on the menu, which never needs an account.
 */
export async function POST(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  const form = await request.formData().catch(() => null);
  const next = localPath(String(form?.get("next") ?? ""));
  const back = new Response(null, {
    headers: { location: next },
    status: 303
  });
  if (!host || !isOwnSite(request)) return back;
  try {
    const { binding, bindingHash } = newBinding();
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/diner-auth/start`,
      {
        body: JSON.stringify({ bindingHash, returnPath: next }),
        cache: "no-store",
        headers: { "content-type": "application/json", host },
        method: "POST"
      }
    );
    if (!upstream.ok) return back;
    const body = (await upstream.json()) as {
      data?: { authorizeUrl?: unknown };
    };
    const target = body.data?.authorizeUrl;
    if (typeof target !== "string") return back;
    return new Response(null, {
      headers: {
        "cache-control": "no-store",
        location: target,
        "set-cookie": bindingCookieHeader(binding)
      },
      status: 303
    });
  } catch {
    return back;
  }
}
