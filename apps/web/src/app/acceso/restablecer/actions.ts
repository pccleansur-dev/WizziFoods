"use server";

import { redirect } from "next/navigation";

import { parseNewPassword } from "../../../auth/auth-input";
import { createAuthServerClient } from "../../../auth/supabase-server";
import type { ResetPasswordState } from "./reset-password-state";

export async function resetPasswordAction(
  _previousState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  void _previousState;
  let password: string;

  try {
    password = parseNewPassword(formData);
  } catch (error) {
    return { message: (error as Error).message, status: "error" };
  }

  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();

  if (claims.error || !claims.data?.claims.sub) {
    return {
      message: "El enlace venció o ya fue utilizado. Solicitá uno nuevo.",
      status: "error"
    };
  }

  const update = await supabase.auth.updateUser({ password });
  if (update.error) {
    return {
      message: "No pudimos actualizar la contraseña. Intentá nuevamente.",
      status: "error"
    };
  }

  await supabase.auth.signOut({ scope: "global" });
  redirect("/acceso?clave-actualizada=1");
}
