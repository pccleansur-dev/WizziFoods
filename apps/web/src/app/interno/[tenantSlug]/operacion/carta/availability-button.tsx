"use client";

import { useActionState } from "react";

import { updateAvailability } from "./actions";

export function AvailabilityButton({
  available,
  productId,
  tenantSlug,
  title,
  version
}: {
  available: boolean;
  productId: string;
  tenantSlug: string;
  title: string;
  version: number | null;
}) {
  const [feedback, action, pending] = useActionState(
    () => updateAvailability(tenantSlug, productId, version, !available),
    null
  );
  const label = available ? "Marcar agotado" : "Volver a ofrecer";

  return (
    <form action={action}>
      <button
        aria-label={`${label}: ${title}`}
        className="button button--secondary"
        disabled={pending}
        type="submit"
      >
        {pending ? "Guardando…" : label}
      </button>
      {feedback ? (
        <p role={feedback.ok ? "status" : "alert"}>{feedback.message}</p>
      ) : null}
    </form>
  );
}
