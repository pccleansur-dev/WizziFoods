"use client";

import { useActionState } from "react";

import { verifyTotpAction } from "../mfa-actions";
import { initialVerificationState } from "../mfa-state";

export function VerificationForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useActionState(
    verifyTotpAction,
    initialVerificationState
  );

  return (
    <form action={action} className="field-stack">
      <input name="factorId" type="hidden" value={factorId} />
      <div className="field-group">
        <label htmlFor="verification-code">Código de 6 dígitos</label>
        <input
          autoComplete="one-time-code"
          autoFocus
          id="verification-code"
          inputMode="numeric"
          maxLength={6}
          name="code"
          pattern="[0-9]{6}"
          required
        />
      </div>
      <button
        className="button button--primary"
        disabled={pending}
        type="submit"
      >
        {pending ? "Verificando…" : "Verificar e ingresar"}
      </button>
      {state.message ? (
        <p className="form-message form-message--error" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
