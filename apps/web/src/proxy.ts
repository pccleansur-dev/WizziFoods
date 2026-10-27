import {
  getTelemetry,
  resolveRequestId,
  startOperation
} from "@platform/observability";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { refreshAuthSession } from "./auth/supabase-proxy";

export async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(
    request.headers.get("x-request-id") ?? undefined
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  let response = NextResponse.next({
    request: { headers: requestHeaders }
  });
  response.headers.set("x-request-id", requestId);
  response = await refreshAuthSession(request, response);

  const telemetry = getTelemetry("web");
  if (telemetry) {
    const operation = startOperation(telemetry, "web.proxy", {
      attributes: { "http.request.method": request.method },
      entryPoint: "http",
      requestId
    });
    response.headers.set("x-trace-id", operation.traceId);
    telemetry.logger.info("web_request_received", {
      entryPoint: "http",
      method: request.method,
      requestId,
      spanId: operation.spanId,
      traceId: operation.traceId
    });
    operation.end();
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest).*)"
  ]
};
