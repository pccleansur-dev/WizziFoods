"use server";

import { redirect } from "next/navigation";

import { parseTotpCode } from "../../auth/auth-input";
import { createAuthServerClient } from "../../auth/supabase-server";
import type { EnrollmentState, VerificationState } from "./mfa-state";

function verificationError(message: string): VerificationState {
  return { message, status: "error" };
}

function readFactorId(formData: FormData): string | null {
  const factorId = formData.get("factorId");
  return typeof factorId === "string" && factorId.length <= 128
    ? factorId
    : null;
}

export async function beginTotpEnrollmentAction(): Promise<EnrollmentState> {
  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();

  if (claims.error || !claims.data?.claims.sub) {
    return {
      message: "La sesión venció. Volvé a ingresar.",
      status: "error"
    };
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Acceso administrativo"
  });

  if (error) {
    return {
      message: "No pudimos iniciar la configuración. Intentá nuevamente.",
      status: "error"
    };
  }

  return {
    factorId: data.id,
    message: "Escaneá el código y confirmalo con los seis dígitos.",
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    status: "ready"
  };
}

async function challengeAndVerify(
  factorId: string,
  code: string
): Promise<VerificationState | null> {
  const supabase = await createAuthServerClient();
  const challenge = await supabase.auth.mfa.challenge({ factorId });

  if (challenge.error) {
    return verificationError(
      "No pudimos iniciar la verificación. Intentá nuevamente."
    );
  }

  const verification = await supabase.auth.mfa.verify({
    challengeId: challenge.data.id,
    code,
    factorId
  });

  if (verification.error) {
    return verificationError(
      "El código no es válido o venció. Generá uno nuevo e intentá otra vez."
    );
  }

  return null;
}

export async function verifyTotpAction(
  _previousState: VerificationState,
  formData: FormData
): Promise<VerificationState> {
  void _previousState;
  const factorId = readFactorId(formData);
  let code: string;

  try {
    code = parseTotpCode(formData);
  } catch (error) {
    return verificationError((error as Error).message);
  }

  if (!factorId) {
    return verificationError("No encontramos el autenticador de esta cuenta.");
  }

  const error = await challengeAndVerify(factorId, code);
  if (error) return error;

  redirect("/panel");
}
