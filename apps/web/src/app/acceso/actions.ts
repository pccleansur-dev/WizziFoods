"use server";

import { readWebAuthConfig } from "@platform/config";
import { redirect } from "next/navigation";

import { parseCredentials, parseEmail } from "../../auth/auth-input";
import { createAuthServerClient } from "../../auth/supabase-server";
import type { AccessActionState } from "./access-state";

const invalidCredentials: AccessActionState = {
  message: "No pudimos verificar esos datos. Revisalos e intentá nuevamente.",
  status: "error"
};

export async function signInWithPasswordAction(
  _previousState: AccessActionState,
  formData: FormData
): Promise<AccessActionState> {
  let credentials: ReturnType<typeof parseCredentials>;

  try {
    credentials = parseCredentials(formData);
  } catch {
    return invalidCredentials;
  }

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    return invalidCredentials;
  }

  redirect("/acceso/continuar");
}

export async function signInWithGoogleAction(
  _previousState: AccessActionState,
  _formData: FormData
): Promise<AccessActionState> {
  void _previousState;
  void _formData;
  const config = readWebAuthConfig(process.env);
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    options: {
      redirectTo: `${config.appUrl}/auth/callback?next=/acceso/continuar`,
      skipBrowserRedirect: true
    },
    provider: "google"
  });

  if (error || !data.url) {
    return {
      message:
        "Google no está disponible en este momento. Probá con tu correo.",
      status: "error"
    };
  }

  redirect(data.url);
}

export async function requestPasswordRecoveryAction(
  _previousState: AccessActionState,
  formData: FormData
): Promise<AccessActionState> {
  let email: string;

  try {
    email = parseEmail(formData);
  } catch (error) {
    return { message: (error as Error).message, status: "error" };
  }

  const config = readWebAuthConfig(process.env);
  const supabase = await createAuthServerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${config.appUrl}/auth/callback?next=/acceso/restablecer`
  });

  return {
    message:
      "Si el correo corresponde a una cuenta activa, vas a recibir las instrucciones para recuperar el acceso.",
    status: "success"
  };
}
