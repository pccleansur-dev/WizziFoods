import { readWebConfig } from "@platform/config";
import { NextResponse } from "next/server";

import { createAuthServerClient } from "../../../../auth/supabase-server";
import { parseBusinessMediaStatus } from "../../../panel/business-media";
import { tenantFetch } from "../../../panel/tenant-fetch";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await context.params;
  if (!uuidPattern.test(assetId)) {
    return errorResponse("Identificador de archivo inválido.", 400);
  }
  const supabase = await createAuthServerClient();
  const [claims, session] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.auth.getSession()
  ]);
  const accessToken = session.data.session?.access_token;
  const host = request.headers.get("host");
  if (
    claims.error ||
    claims.data?.claims.aal !== "aal2" ||
    session.error ||
    !accessToken ||
    !host
  ) {
    return errorResponse("La sesión venció.", 401);
  }

  try {
    const config = readWebConfig(process.env);
    const response = await tenantFetch(
      `${config.apiUrl}/v1/tenant/business-media/${assetId}`,
      {
        cache: "no-store",
        headers: { authorization: `Bearer ${accessToken}`, host }
      }
    );
    if (!response.ok) {
      return errorResponse("No pudimos consultar la imagen.", response.status);
    }
    return NextResponse.json({
      data: parseBusinessMediaStatus(await response.json())
    });
  } catch {
    return errorResponse("No pudimos consultar la imagen.", 502);
  }
}
