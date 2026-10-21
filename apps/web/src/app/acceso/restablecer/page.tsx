import { redirect } from "next/navigation";

import { createAuthServerClient } from "../../../auth/supabase-server";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage() {
  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();

  if (claims.error || !claims.data?.claims.sub) {
    redirect("/acceso?error=enlace-vencido");
  }

  return (
    <main className="mfa-shell">
      <section className="mfa-card" aria-labelledby="reset-title">
        <p className="access-step">Recuperación de acceso</p>
        <h1 id="reset-title">Elegí una nueva contraseña</h1>
        <p>
          Usá al menos 12 caracteres. Al guardar, cerraremos todas las sesiones
          activas para proteger la cuenta.
        </p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
