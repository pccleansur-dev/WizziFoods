"use client";

import { useActionState } from "react";

import { suspendTenantAction } from "./actions";
import type { PlatformTenantSummary } from "./platform-operations";
import type { TenantSuspensionActionState } from "./tenant-suspension-state";

export function TenantSuspensionForm({
  tenants
}: {
  tenants: PlatformTenantSummary[];
}) {
  const initialState: TenantSuspensionActionState = {
    message: "",
    status: "idle"
  };
  const [state, formAction, pending] = useActionState(
    suspendTenantAction,
    initialState
  );
  const eligibleTenants = tenants.filter(
    (tenant) => tenant.status !== "suspended" && !tenant.suspension
  );

  if (eligibleTenants.length === 0) {
    return (
      <p className="panel-empty-state" role="status">
        No hay negocios activos disponibles para suspender.
      </p>
    );
  }

  return (
    <form action={formAction} className="suspension-form">
      <div className="field-group">
        <label htmlFor="suspension-tenant">Negocio</label>
        <select id="suspension-tenant" name="tenantId" required>
          <option value="">Seleccioná un negocio</option>
          {eligibleTenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name} · {tenant.status}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="suspension-mode-group">
        <legend>Tipo de suspensión</legend>
        <label>
          <input defaultChecked name="mode" type="radio" value="commercial" />
          <span>
            <strong>Comercial gradual</strong>
            <small>
              Impide nuevas mesas y conserva las abiertas hasta que finalicen.
            </small>
          </span>
        </label>
        <label>
          <input name="mode" type="radio" value="security" />
          <span>
            <strong>Seguridad inmediata</strong>
            <small>
              Suspende el negocio y revoca las sesiones del personal en el acto.
            </small>
          </span>
        </label>
      </fieldset>

      <div className="field-group">
        <label htmlFor="suspension-reason">Motivo auditable</label>
        <textarea
          id="suspension-reason"
          maxLength={500}
          minLength={3}
          name="reason"
          placeholder="Detallá por qué se toma esta medida"
          required
          rows={3}
        />
      </div>

      <label className="suspension-confirmation">
        <input name="confirmed" required type="checkbox" value="yes" />
        <span>Confirmo que revisé el negocio, el motivo y el impacto.</span>
      </label>

      <button
        className="button button--danger"
        disabled={pending}
        type="submit"
      >
        {pending ? "Aplicando suspensión…" : "Aplicar suspensión"}
      </button>
      {state.message ? (
        <p
          aria-live={state.status === "error" ? "assertive" : "polite"}
          className={`form-message form-message--${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
