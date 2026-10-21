import { readWebAuthConfig } from "@platform/config";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function hardenedCookieOptions(
  options: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...options,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  };
}

export async function refreshAuthSession(
  request: NextRequest,
  response: NextResponse
): Promise<NextResponse> {
  const config = readWebAuthConfig(process.env);
  const supabase = createServerClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      cookieOptions: hardenedCookieOptions({}),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, options, value }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, hardenedCookieOptions(options));
          });
          Object.entries(headers).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        }
      }
    }
  );

  await supabase.auth.getClaims();
  return response;
}
