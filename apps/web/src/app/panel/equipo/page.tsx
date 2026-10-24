import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../../auth/load-admin-access";
import { teamCommandAction } from "./actions";
import { TeamManager } from "./team-manager";
import { loadTeam } from "./team";
import { OnboardingShell } from "../onboarding/onboarding-shell";

export default async function TeamPage() {
  const result = await loadAdministrativeAccess();
  if (result.status === "unauthenticated") redirect("/acceso/continuar");

  const isTenantAdmin =
    result.status === "ready" && result.data.access.type === "tenant_admin";
  const team = isTenantAdmin ? await loadTeam() : null;

  return (
    <OnboardingShell current="equipo">
      {team?.status === "ready" ? (
        <TeamManager
          initialMembers={team.members}
          onCommand={teamCommandAction}
          sectors={team.sectors}
        />
      ) : (
        <section className="panel-content" role="alert">
          <p className="eyebrow">Equipo</p>
          <h1>No pudimos cargar el equipo</h1>
          <p className="panel-lead">
            {isTenantAdmin
              ? "Tu sesión sigue protegida. Esperá un momento y volvé a intentar."
              : "Esta sección es exclusiva del Administrador del negocio."}
          </p>
        </section>
      )}
    </OnboardingShell>
  );
}
