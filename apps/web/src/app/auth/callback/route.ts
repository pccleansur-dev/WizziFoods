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

    return NextResponse.redirect(
      new URL(
        error ? "/acceso?error=no-se-pudo-validar" : destination,
        config.appUrl
      )
    );
  }

  // Sin `code` puede ser una invitación: su sesión viaja en el fragmento (`#access_token=…`), que el
  // servidor no ve. El navegador conserva el fragmento al seguir esta redirección y la página cliente
  // lo recoge; si no hay nada que recoger, esa página manda a /acceso.
  if (!request.nextUrl.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/auth/invitacion", config.appUrl));
  }

  return NextResponse.redirect(
    new URL("/acceso?error=no-se-pudo-validar", config.appUrl)
  );
}
