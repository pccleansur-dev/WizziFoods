import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../../auth/load-admin-access";
import { loadBusinessProfileDraft } from "../business-profile";
import { BusinessStep } from "../onboarding/business-step";
import { loadGoogleReviewLink } from "./google-review-actions";
import { GoogleReviewForm } from "./google-review-form";
import { loadOrderHours } from "./order-hours-actions";
import { OrderHoursForm } from "./order-hours-form";
import { OnboardingShell } from "../onboarding/onboarding-shell";

export default async function BusinessPage() {
  const result = await loadAdministrativeAccess();
  if (result.status === "unauthenticated") redirect("/acceso/continuar");

  const context =
    result.status === "ready" && result.data.access.type === "tenant_admin"
      ? result.data.access.tenantContexts[0]
      : undefined;
  if (!context) {
    return (
      <OnboardingShell current="negocio">
        <section className="panel-content" role="alert">
          <p className="eyebrow">Negocio</p>
          <h1>No pudimos cargar los datos del negocio</h1>
          <p className="panel-lead">
            Esta sección es exclusiva del Administrador del negocio.
          </p>
        </section>
      </OnboardingShell>
    );
  }

  const host = (await headers()).get("host") ?? "";
  const [profile, hours, review] = await Promise.all([
    loadBusinessProfileDraft(host),
    loadOrderHours(),
    loadGoogleReviewLink()
  ]);
  return (
    <OnboardingShell current="negocio">
      <BusinessStep
        businessProfile={profile.status === "ready" ? profile.data : null}
        tenantName={context.tenant.name}
        hoursPanel={
          hours ? (
            <OrderHoursForm hours={hours} />
          ) : (
            <p role="alert">No pudimos cargar los horarios de pedidos.</p>
          )
        }
        reviewPanel={
          review ? (
            <GoogleReviewForm url={review.url} />
          ) : (
            <p role="alert">No pudimos cargar el enlace de reseñas.</p>
          )
        }
      />
    </OnboardingShell>
  );
}
