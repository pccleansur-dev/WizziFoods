import { readWebAuthConfig } from "@platform/config";
import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "../../../auth/auth-input";
import { createAuthServerClient } from "../../../auth/supabase-server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = readWebAuthConfig(process.env);
  const code = request.nextUrl.searchParams.get("code");
  const destination = safeRedirectPath(
    request.nextUrl.searchParams.get("next")
  );

  if (code) {
    const supabase = await createAuthServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(destination, config.appUrl));
    }
  }

  return NextResponse.redirect(
    new URL("/acceso?error=no-se-pudo-validar", config.appUrl)
  );
}
