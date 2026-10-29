"use client";

import type { LoyaltyRewardKind, LoyaltySettings } from "@platform/contracts";
import { useEffect, useState } from "react";

import {
  getLoyaltySettingsAction,
  saveLoyaltySettingsAction
} from "../loyalty-actions";

type Draft = {
  enabled: boolean;
  minSpend: string;
  minSessionMinutes: string;
  visitsGoal: string;
  rewardKind: LoyaltyRewardKind;
  rewardValue: string;
};

function toDraft(settings: LoyaltySettings): Draft {
  return {
    enabled: settings.enabled,
    minSessionMinutes: String(settings.minSessionMinutes),
    minSpend: String(settings.minSpendCents / 100),
    rewardKind: settings.rewardKind,
    rewardValue: String(settings.rewardValue / 100),
    visitsGoal: String(settings.visitsGoal)
  };
}

/**
 * The manager sets the program: how much a visit needs, how many visits earn a reward
 * and what the reward is. Only whole pesos and whole percentages are typed here.
 */
export function LoyaltySettingsPanel({ tenantSlug }: { tenantSlug: string }) {
  const [base, setBase] = useState<LoyaltySettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getLoyaltySettingsAction(tenantSlug).then((result) => {
      if (result.status === "ok") {
        setBase(result.data);
        setDraft(toDraft(result.data));
      }
    });
  }, [tenantSlug]);

  if (!base || !draft) return null;
  const current = base;

  async function save() {
    if (!draft) return;
    const minSpendCents = Math.round(Number(draft.minSpend) * 100);
    const rewardValue = Math.round(Number(draft.rewardValue) * 100);
    setBusy(true);
    const result = await saveLoyaltySettingsAction(tenantSlug, {
      ...current,
      enabled: draft.enabled,
      minSessionMinutes: Number(draft.minSessionMinutes),
      minSpendCents,
      rewardKind: draft.rewardKind,
      rewardValue,
      visitsGoal: Number(draft.visitsGoal)
    });
    setBusy(false);
    if (result.status === "ok") {
      setBase(result.data);
      setDraft(toDraft(result.data));
      setMessage("Guardamos el programa de premios.");
    } else {
      setMessage(result.message);
    }
  }

  function change(patch: Partial<Draft>) {
    setDraft({ ...(draft as Draft), ...patch });
  }

  return (
    <section
      aria-label="Programa de premios"
      className="waiter-reject loyalty-settings"
    >
      <h3>Programa de premios</h3>
      <label>
        <input
          checked={draft.enabled}
          onChange={(event) => change({ enabled: event.target.checked })}
          type="checkbox"
        />{" "}
        Programa activo
      </label>
      <label htmlFor="loyalty-goal">Visitas para ganar un premio</label>
      <input
        id="loyalty-goal"
        inputMode="numeric"
        onChange={(event) => change({ visitsGoal: event.target.value })}
        value={draft.visitsGoal}
      />
      <label htmlFor="loyalty-min">Consumo mínimo por visita ($)</label>
      <input
        id="loyalty-min"
        inputMode="decimal"
        onChange={(event) => change({ minSpend: event.target.value })}
        value={draft.minSpend}
      />
      <label htmlFor="loyalty-kind">Tipo de premio</label>
      <select
        id="loyalty-kind"
        onChange={(event) =>
          change({ rewardKind: event.target.value as LoyaltyRewardKind })
        }
        value={draft.rewardKind}
      >
        <option value="percent">Porcentaje de descuento</option>
        <option value="amount">Monto de descuento</option>
      </select>
      <label htmlFor="loyalty-value">
        {draft.rewardKind === "percent" ? "Descuento (%)" : "Descuento ($)"}
      </label>
      <input
        id="loyalty-value"
        inputMode="decimal"
        onChange={(event) => change({ rewardValue: event.target.value })}
        value={draft.rewardValue}
      />
      <label htmlFor="loyalty-minutes">Permanencia mínima (minutos)</label>
      <input
        id="loyalty-minutes"
        inputMode="numeric"
        onChange={(event) => change({ minSessionMinutes: event.target.value })}
        value={draft.minSessionMinutes}
      />
      <button
        className="button button--primary"
        disabled={busy}
        onClick={() => void save()}
        type="button"
      >
        Guardar programa
      </button>
      {message !== null ? (
        <p aria-live="polite" className="waiter-note" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
