import { redirect } from "next/navigation";

import { resolveMfaRoute } from "../../../auth/mfa-route";
import { createAuthServerClient } from "../../../auth/supabase-server";

function knownLevel(value: string | null): "aal1" | "aal2" | null {
  return value === "aal1" || value === "aal2" ? value : null;
}

export default async function ContinueAccessPage() {
  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();

  if (claims.error || !claims.data?.claims.sub) {
    redirect("/acceso");
  }

  const [assurance, factors] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors()
  ]);

  if (assurance.error || factors.error) {
    redirect("/acceso?error=no-se-pudo-validar");
  }

  const verifiedFactorCount = factors.data.totp.filter(
    (factor) => factor.status === "verified"
  ).length;

  redirect(
    resolveMfaRoute({
      currentLevel: knownLevel(assurance.data.currentLevel),
      nextLevel: knownLevel(assurance.data.nextLevel),
      verifiedFactorCount
    })
  );
}
