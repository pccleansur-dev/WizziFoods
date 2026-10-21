"use client";

import { useActionState } from "react";

import {
  requestPasswordRecoveryAction,
  signInWithGoogleAction,
  signInWithPasswordAction
} from "./actions";
import { initialAccessState } from "./access-state";

function ActionMessage({
  message,
  status
}: {
  message: string;
  status: "idle" | "error" | "success";
}) {
  if (!message) return null;

  return (
    <p className={`form-message form-message--${status}`} role="status">
      {message}
    </p>
  );
}

export function LoginForm() {
  const [passwordState, passwordAction, passwordPending] = useActionState(
    signInWithPasswordAction,
    initialAccessState
  );
  const [googleState, googleAction, googlePending] = useActionState(
    signInWithGoogleAction,
    initialAccessState
  );
  const [recoveryState, recoveryAction, recoveryPending] = useActionState(
    requestPasswordRecoveryAction,
    initialAccessState
  );

  return (
    <div className="access-form-stack">
      <form action={googleAction}>
        <button
          className="button button--google"
          disabled={googlePending}
          type="submit"
        >
          <span aria-hidden="true" className="google-mark">
            G
          </span>
          {googlePending ? "Conectando…" : "Continuar con Google"}
        </button>
        <ActionMessage {...googleState} />
      </form>

      <div className="access-divider" role="separator">
        <span>o ingresá con credenciales</span>
      </div>

      <form action={passwordAction} className="field-stack">
        <div className="field-group">
          <label htmlFor="email">Correo electrónico</label>
          <input
            autoComplete="email"
            id="email"
            maxLength={254}
            name="email"
            placeholder="nombre@negocio.com"
            required
            type="email"
          />
        </div>
        <div className="field-group">
          <label htmlFor="password">Contraseña</label>
          <input
            autoComplete="current-password"
            id="password"
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
        </div>
        <button
          className="button button--primary"
          disabled={passwordPending}
          type="submit"
        >
          {passwordPending ? "Verificando…" : "Ingresar"}
        </button>
        <ActionMessage {...passwordState} />
      </form>

      <details className="recovery-panel">
        <summary>¿Olvidaste tu contraseña?</summary>
        <form action={recoveryAction} className="field-stack recovery-form">
          <div className="field-group">
            <label htmlFor="recovery-email">Correo de la cuenta</label>
            <input
              autoComplete="email"
              id="recovery-email"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </div>
          <button
            className="button button--secondary"
            disabled={recoveryPending}
            type="submit"
          >
            {recoveryPending ? "Enviando…" : "Enviar instrucciones"}
          </button>
          <ActionMessage {...recoveryState} />
        </form>
      </details>
    </div>
  );
}
