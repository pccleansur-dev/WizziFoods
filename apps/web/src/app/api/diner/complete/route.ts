import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../../panel/tenant-fetch";
import {
  bindingCookie,
  clearBindingCookie,
  localPath,
  readCookie,
  sessionCookieHeader
} from "../diner-proxy";

const codePattern = /^[A-Za-z0-9_-]{43}$/u;

/**
 * The restaurant end of the Google login: swaps the one-time code (plus the secret
 * only this browser holds) for a session cookie scoped to this host, then returns
 * to the page the diner came from. A failure just returns without a session.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const next = localPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code") ?? "";
  const binding = readCookie(request, bindingCookie);
  const host = request.headers.get("host") ?? "";
  const headers = new Headers({
    "cache-control": "no-store",
    location: next
  });
  headers.append("set-cookie", clearBindingCookie());
  if (!host || !binding || !codePattern.test(code)) {
    return new Response(null, { headers, status: 303 });
  }
  try {
    const config = readWebConfig(process.env);
    const upstream = await tenantFetch(
      `${config.apiUrl}/v1/public/diner-auth/session`,
      {
        body: JSON.stringify({ binding, code }),
        cache: "no-store",
        headers: { "content-type": "application/json", host },
        method: "POST"
      }
    );
    if (upstream.ok) {
      const body = (await upstream.json()) as {
        data?: { sessionToken?: unknown };
      };
      if (typeof body.data?.sessionToken === "string") {
        headers.append(
          "set-cookie",
          sessionCookieHeader(body.data.sessionToken)
        );
      }
    }
  } catch {
    // The menu works without an account: fall through to the redirect.
  }
  return new Response(null, { headers, status: 303 });
}
