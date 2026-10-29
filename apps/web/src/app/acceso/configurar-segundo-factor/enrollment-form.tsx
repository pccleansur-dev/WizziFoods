"use client";

import { useActionState } from "react";

import { beginTotpEnrollmentAction, verifyTotpAction } from "../mfa-actions";
import { initialEnrollmentState, initialVerificationState } from "../mfa-state";

export function EnrollmentForm() {
  const [enrollment, beginEnrollment, enrollmentPending] = useActionState(
    beginTotpEnrollmentAction,
    initialEnrollmentState
  );
  const [verification, verifyCode, verificationPending] = useActionState(
    verifyTotpAction,
    initialVerificationState
  );

  if (enrollment.status !== "ready" || !enrollment.factorId) {
    return (
      <form action={beginEnrollment}>
        <button
          className="button button--primary"
          disabled={enrollmentPending}
          type="submit"
        >
          {enrollmentPending ? "Preparando…" : "Configurar autenticador"}
        </button>
        {enrollment.message ? (
          <p className="form-message form-message--error" role="status">
            {enrollment.message}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="enrollment-content">
      <p className="form-message form-message--success" role="status">
        {enrollment.message}
      </p>
      {enrollment.qrCode ? (
        // Supabase returns a data URL containing the account-specific QR.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt="Código QR para configurar el autenticador"
          className="totp-qr"
          height="224"
          src={enrollment.qrCode}
          width="224"
        />
      ) : null}
      {enrollment.secret ? (
        <details className="manual-secret">
          <summary>No puedo escanear el código</summary>
          <p>Ingresá esta clave manualmente en tu aplicación:</p>
          <code>{enrollment.secret}</code>
        </details>
      ) : null}
      <form action={verifyCode} className="field-stack">
        <input name="factorId" type="hidden" value={enrollment.factorId} />
        <div className="field-group">
          <label htmlFor="enrollment-code">Código de 6 dígitos</label>
          <input
            autoComplete="one-time-code"
            id="enrollment-code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            pattern="[0-9]{6}"
            title="Ingresá los 6 dígitos de tu aplicación autenticadora."
            required
          />
        </div>
        <button
          className="button button--primary"
          disabled={verificationPending}
          type="submit"
        >
          {verificationPending ? "Verificando…" : "Activar segundo factor"}
        </button>
        {verification.message ? (
          <p className="form-message form-message--error" role="status">
            {verification.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
