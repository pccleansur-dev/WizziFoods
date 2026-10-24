import { readWebConfig } from "@platform/config";
import {
  evaluateBusinessMediaUpload,
  type BusinessMediaKind
} from "@platform/contracts";
import { NextResponse } from "next/server";

import { createAuthServerClient } from "../../../auth/supabase-server";
import {
  parseBusinessMediaReservation,
  parseBusinessMediaStatus
} from "../../panel/business-media";
import { tenantFetch } from "../../panel/tenant-fetch";
import { isSameOrigin } from "./same-origin";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return errorResponse("Solicitud no permitida.", 403);
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("Archivo inválido.", 400);
  }
  const file = formData.get("file");
  const kind = formData.get("kind");
  const decision =
    file instanceof File
      ? evaluateBusinessMediaUpload({
          byteLength: file.size,
          contentType: file.type,
          currentTenantBytes: 0
        })
      : { accepted: false as const };
  if (
    !(kind === "cover" || kind === "logo" || kind === "reference") ||
    !file ||
    !(file instanceof File) ||
    !decision.accepted
  ) {
    return errorResponse("Usá una imagen JPG, PNG o WebP de hasta 12 MB.", 400);
  }

  try {
    const config = readWebConfig(process.env);
    const apiHeaders = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      host
    };
    const reservationResponse = await tenantFetch(
      `${config.apiUrl}/v1/tenant/business-media/reservations`,
      {
        body: JSON.stringify({
          byteLength: file.size,
          contentType: file.type,
          kind: kind as BusinessMediaKind
        }),
        cache: "no-store",
        headers: apiHeaders,
        method: "POST"
      }
    );
    if (!reservationResponse.ok) {
      return errorResponse("No pudimos reservar espacio para la imagen.", 502);
    }
    const reservation = parseBusinessMediaReservation(
      await reservationResponse.json()
    );
    const uploadToken = new URL(reservation.uploadUrl).searchParams.get(
      "token"
    );
    if (!uploadToken) throw new Error("missing upload token");
    const upload = await supabase.storage
      .from("business-media")
      .uploadToSignedUrl(reservation.objectPath, uploadToken, file, {
        cacheControl: "3600",
        contentType: reservation.contentType,
        upsert: false
      });
    if (upload.error) {
      return errorResponse("No pudimos cargar la imagen.", 502);
    }

    const queueResponse = await tenantFetch(
      `${config.apiUrl}/v1/tenant/business-media/${reservation.id}/processing`,
      {
        cache: "no-store",
        headers: apiHeaders,
        method: "POST"
      }
    );
    if (!queueResponse.ok) {
      return errorResponse("La imagen subió, pero no pudo procesarse.", 502);
    }
    const status = parseBusinessMediaStatus(await queueResponse.json());
    return NextResponse.json({ data: status }, { status: 202 });
  } catch {
    return errorResponse("No pudimos procesar la imagen.", 502);
  }
}
