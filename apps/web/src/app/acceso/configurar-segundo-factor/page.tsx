import { redirect } from "next/navigation";

import { createAuthServerClient } from "../../../auth/supabase-server";
import { EnrollmentForm } from "./enrollment-form";

export default async function ConfigureSecondFactorPage() {
  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();

  if (claims.error || !claims.data?.claims.sub) {
    redirect("/acceso");
  }

  return (
    <main className="mfa-shell">
      <section className="mfa-card" aria-labelledby="mfa-title">
        <p className="access-step">Protección de la cuenta</p>
        <h1 id="mfa-title">Configurá tu segundo factor</h1>
        <p>
          Usá una aplicación autenticadora como Google Authenticator, Microsoft
          Authenticator o 1Password. Este paso es obligatorio para administrar
          Wizzi Foods.
        </p>
        <ol className="mfa-steps">
          <li>Generá el código QR.</li>
          <li>Escanealo con tu aplicación autenticadora.</li>
          <li>Confirmá el código de seis dígitos.</li>
        </ol>
        <EnrollmentForm />
      </section>
    </main>
  );
}
