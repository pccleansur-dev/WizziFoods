import { readWebConfig } from "@platform/config";

import { tenantFetch } from "../../../panel/tenant-fetch";
import {
  clearSessionCookie,
  isOwnSite,
  readCookie,
  sessionCookie
} from "../diner-proxy";

/** Ends the session on the API and forgets it in the browser, whatever the API says. */
export async function POST(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? "";
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", clearSessionCookie());
  if (!isOwnSite(request)) {
    return new Response(null, { headers, status: 403 });
  }
  const token = readCookie(request, sessionCookie);
  if (host && token) {
    try {
      const config = readWebConfig(process.env);
      await tenantFetch(`${config.apiUrl}/v1/public/diner-auth/session`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}`, host },
        method: "DELETE"
      });
    } catch {
      // The cookie is gone either way; the session expires on its own.
    }
  }
  return new Response(null, { headers, status: 204 });
}
