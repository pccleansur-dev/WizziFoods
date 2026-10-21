import { redirect } from "next/navigation";

import { createAuthServerClient } from "../../../auth/supabase-server";
import { VerificationForm } from "./verification-form";

export default async function SecondFactorPage() {
  const supabase = await createAuthServerClient();
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp.find(
    (candidate) => candidate.status === "verified"
  );

  if (factors.error || !factor) {
    redirect("/acceso/configurar-segundo-factor");
  }

  return (
    <main className="mfa-shell">
      <section className="mfa-card" aria-labelledby="mfa-title">
        <p className="access-step">Segundo factor</p>
        <h1 id="mfa-title">Confirmá que sos vos</h1>
        <p>
          Abrí tu aplicación autenticadora e ingresá el código actual. Los
          códigos cambian cada pocos segundos.
        </p>
        <VerificationForm factorId={factor.id} />
      </section>
    </main>
  );
}
