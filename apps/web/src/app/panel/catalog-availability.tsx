"use client";

import { useActionState } from "react";

import { setCatalogAvailabilityAction } from "./actions";
import type { CatalogAvailabilityActionState } from "./catalog-availability-state";
import type { CatalogAvailability } from "./catalog";

export function CatalogAvailabilityControl({
  initialAvailability,
  productId,
  productTitle
}: {
  initialAvailability: CatalogAvailability | undefined;
  productId: string;
  productTitle: string;
}) {
  const initialState: CatalogAvailabilityActionState = {
    isAvailable: initialAvailability?.isAvailable ?? true,
    message: "",
    status: "idle",
    version: initialAvailability?.version ?? null
  };
  const [state, action, pending] = useActionState(
    setCatalogAvailabilityAction,
    initialState
  );
  const nextAvailability = !state.isAvailable;

  return (
    <form action={action} className="catalog-availability-row">
      <div>
        <strong>{productTitle}</strong>
        <span
          className={`catalog-availability-status catalog-availability-status--${state.isAvailable ? "available" : "unavailable"}`}
        >
          {state.isAvailable ? "Disponible" : "No disponible"}
        </span>
      </div>
      <input name="productId" type="hidden" value={productId} />
      <input name="expectedVersion" type="hidden" value={state.version ?? ""} />
      <input
        name="isAvailable"
        type="hidden"
        value={String(nextAvailability)}
      />
      <button
        aria-pressed={!state.isAvailable}
        className="button button--secondary"
        disabled={pending}
        type="submit"
      >
        {pending
          ? "Actualizando…"
          : nextAvailability
            ? "Marcar disponible"
            : "Marcar no disponible"}
      </button>
      {state.message ? (
        <p
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
