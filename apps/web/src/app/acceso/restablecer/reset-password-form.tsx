"use client";

import { useActionState } from "react";

import { resetPasswordAction } from "./actions";
import { initialResetPasswordState } from "./reset-password-state";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(
    resetPasswordAction,
    initialResetPasswordState
  );

  return (
    <form action={action} className="field-stack">
      <div className="field-group">
        <label htmlFor="new-password">Nueva contraseña</label>
        <input
          autoComplete="new-password"
          id="new-password"
          maxLength={128}
          minLength={12}
          name="password"
          required
          type="password"
        />
      </div>
      <div className="field-group">
        <label htmlFor="password-confirmation">Repetí la contraseña</label>
        <input
          autoComplete="new-password"
          id="password-confirmation"
          maxLength={128}
          minLength={12}
          name="passwordConfirmation"
          required
          type="password"
        />
      </div>
      <button
        className="button button--primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "Actualizando…" : "Guardar nueva contraseña"}
      </button>
      {state.message ? (
        <p className="form-message form-message--error" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
