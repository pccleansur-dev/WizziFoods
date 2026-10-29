import { NextResponse, type NextRequest } from "next/server";

import { createAuthServerClient } from "../../../../auth/supabase-server";
import { isSameOrigin } from "../../../api/business-media/same-origin";

const tokenPattern = /^[A-Za-z0-9._-]{8,4096}$/u;

function invalid(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 400 });
}

/**
 * Cierra el ingreso por invitación: el enlace de Supabase entrega la sesión en el fragmento de la
 * URL (el servidor nunca lo ve), la página cliente la reenvía acá y las cookies quedan httpOnly.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Detrás del proxy la URL de la solicitud es interna; `Host` y `Origin` son los públicos.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const accessToken = (body as { accessToken?: unknown } | null)?.accessToken;
  const refreshToken = (body as { refreshToken?: unknown } | null)
    ?.refreshToken;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    !tokenPattern.test(accessToken) ||
    !tokenPattern.test(refreshToken)
  ) {
    return invalid();
  }

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  return error
    ? NextResponse.json({ ok: false }, { status: 401 })
    : NextResponse.json({ ok: true });
}
