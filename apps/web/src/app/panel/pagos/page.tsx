import { redirect } from "next/navigation";

import { loadAdministrativeAccess } from "../../../auth/load-admin-access";
import { paymentsCommandAction } from "./actions";
import { PaymentMethodsManager } from "./payment-methods-manager";
import { loadPaymentMethods } from "./payments";
import { OnboardingShell } from "../onboarding/onboarding-shell";

export default async function PaymentMethodsPage() {
  const result = await loadAdministrativeAccess();
  if (result.status === "unauthenticated") redirect("/acceso/continuar");

  const isTenantAdmin =
    result.status === "ready" && result.data.access.type === "tenant_admin";
  const payments = isTenantAdmin ? await loadPaymentMethods() : null;

  return (
    <OnboardingShell current="pagos">
      {payments?.status === "ready" ? (
        <PaymentMethodsManager
          initialMethods={payments.methods}
          onCommand={paymentsCommandAction}
        />
      ) : (
        <section className="panel-content" role="alert">
          <p className="eyebrow">Medios de pago</p>
          <h1>No pudimos cargar los medios de pago</h1>
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
