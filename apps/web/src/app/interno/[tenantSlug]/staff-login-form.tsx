"use client";

import { useActionState } from "react";

import { signInStaffAction } from "./actions";
import { initialStaffAccessState } from "./staff-access-state";

export function StaffLoginForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, action, pending] = useActionState(
    signInStaffAction,
    initialStaffAccessState
  );

  return (
    <form action={action} className="field-stack staff-login-form">
      <label className="field-group">
        <span>Código del local</span>
        <input
          autoCapitalize="none"
          autoComplete="off"
          defaultValue={tenantSlug}
          maxLength={80}
          name="tenantSlug"
          placeholder="ej. pcclean"
          required
          spellCheck={false}
          type="text"
        />
      </label>
      <div className="field-group">
        <label htmlFor="staff-username">Usuario</label>
        <input
          autoCapitalize="none"
          autoComplete="username"
          id="staff-username"
          maxLength={64}
          name="username"
          placeholder="ej. ana.moza"
          required
          spellCheck={false}
          type="text"
        />
      </div>
      <div className="field-group">
        <label htmlFor="staff-pin">PIN de 6 dígitos</label>
        <input
          aria-describedby="staff-pin-hint"
          autoComplete="current-password"
          id="staff-pin"
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="pin"
          pattern="[0-9]{6}"
          title="El PIN tiene 6 dígitos, sin letras ni espacios."
          required
          type="password"
        />
        <small id="staff-pin-hint">
          Es personal. No lo compartas con otros integrantes del equipo.
        </small>
      </div>
      <button
        className="button button--primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "Verificando…" : "Entrar a la operación"}
      </button>
      {state.message ? (
        <p className="form-message form-message--error" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
