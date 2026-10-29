"use client";

import { useActionState, useEffect, useRef } from "react";

import { createTenantAction } from "./actions";
import { suggestBusinessSlug } from "./business-slug";
import type { TenantProvisioningActionState } from "./tenant-provisioning-state";

export function TenantProvisioningForm({
  idempotencyKey
}: {
  idempotencyKey: string;
}) {
  const initialState: TenantProvisioningActionState = {
    idempotencyKey,
    message: "",
    status: "idle"
  };
  const [state, formAction, pending] = useActionState(
    createTenantAction,
    initialState
  );

  const slugInput = useRef<HTMLInputElement>(null);
  // Mientras no se edite a mano, el identificador sigue al nombre.
  const slugEdited = useRef(false);
  useEffect(() => {
    slugEdited.current = false;
  }, [state.idempotencyKey]);

  return (
    <form
      action={formAction}
      className="provisioning-form"
      key={state.idempotencyKey}
    >
      <div className="field-group">
        <label htmlFor="business-name">Nombre del negocio</label>
        <input
          autoComplete="organization"
          id="business-name"
          maxLength={120}
          minLength={2}
          name="name"
          onChange={(event) => {
            if (slugInput.current && !slugEdited.current) {
              slugInput.current.value = suggestBusinessSlug(
                event.currentTarget.value
              );
            }
          }}
          placeholder="Bodegón del Centro"
          required
        />
      </div>
      <div className="field-group">
        <label htmlFor="business-slug">Identificador para la URL</label>
        <input
          aria-describedby="business-slug-help"
          id="business-slug"
          maxLength={80}
          name="slug"
          onChange={() => {
            slugEdited.current = true;
          }}
          ref={slugInput}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          title="Usá solo minúsculas, números y guiones, sin espacios ni guiones al inicio o al final."
          placeholder="bodegon-del-centro"
          required
        />
        <small id="business-slug-help">
          Minúsculas, números y guiones. Después formará parte del acceso del
          negocio.
        </small>
      </div>
      <div className="field-group">
        <label htmlFor="business-admin-email">Correo del administrador</label>
        <input
          autoComplete="email"
          id="business-admin-email"
          maxLength={254}
          name="adminEmail"
          placeholder="administracion@negocio.com"
          required
          type="email"
        />
      </div>
      <button
        className="button button--primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "Creando e invitando…" : "Crear negocio y enviar invitación"}
      </button>
      {state.message ? (
        <p
          className={`form-message form-message--${state.status}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
