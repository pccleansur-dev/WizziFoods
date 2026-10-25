"use client";

import type { DinerLoyaltyView, DinerReward } from "@platform/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  loadLoyalty,
  releaseReward,
  reserveReward,
  saveBirthday
} from "../diner-account/diner-client";

const months = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre"
];

function money(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    style: "currency"
  }).format(cents / 100);
}

function rewardLabel(reward: DinerReward): string {
  return reward.kind === "percent"
    ? `${reward.value / 100}% de descuento`
    : `${money(reward.value)} de descuento`;
}

/**
 * Visits, birthday and rewards of this restaurant. It loads after the page and a
 * failure here never affects the menu or the rest of the account screen.
 */
export function LoyaltyPanel() {
  const [view, setView] = useState<DinerLoyaltyView | null>(null);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState("1");
  const [day, setDay] = useState("1");

  const apply = useCallback(
    (outcome: Awaited<ReturnType<typeof loadLoyalty>>) => {
      if (!outcome.ok) return;
      setView(outcome.value);
      if (outcome.value.birthday) {
        setMonth(String(outcome.value.birthday.month));
        setDay(String(outcome.value.birthday.day));
      }
    },
    []
  );
  const refresh = useCallback(async () => apply(await loadLoyalty()), [apply]);

  useEffect(() => {
    void loadLoyalty().then(apply);
  }, [apply]);

  if (!view?.enabled) return null;
  const openSession = view.openSessions[0] ?? null;
  const remaining = Math.max(0, view.visitsGoal - view.progress);

  async function run(
    action: () => Promise<{ message?: string; ok: boolean }>,
    success: string
  ) {
    setBusy(true);
    const outcome = await action();
    setBusy(false);
    setMessage(
      outcome.ok
        ? { error: false, text: success }
        : { error: true, text: outcome.message ?? "No pudimos completarlo." }
    );
    await refresh();
  }

  return (
    <section aria-label="Mis premios" className="diner-account-panel__loyalty">
      <h2>Mis premios</h2>
      <p>
        Visitas para tu próximo premio:{" "}
        <strong>
          {Math.min(view.progress, view.visitsGoal)} de {view.visitsGoal}
        </strong>
        {view.rewards.length > 0
          ? " · ¡ya tenés un premio disponible!"
          : ` · te faltan ${remaining}`}
      </p>
      <progress
        aria-label="Progreso hacia tu próximo premio"
        max={view.visitsGoal}
        value={Math.min(view.progress, view.visitsGoal)}
      />
      <small>
        Cuenta una visita por día cuando tu consumo llega a{" "}
        {money(view.minSpendCents)}.
      </small>

      {view.rewards.length === 0 ? (
        <p>Todavía no tenés premios disponibles.</p>
      ) : (
        <ul>
          {view.rewards.map((reward) => (
            <li key={reward.rewardId}>
              <strong>{rewardLabel(reward)}</strong>
              {reward.status === "reserved" ? (
                <>
                  {" "}
                  <span>Reservado para tu cuenta: avisale al mozo.</span>{" "}
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => releaseReward({ rewardId: reward.rewardId }),
                        "Liberamos el premio."
                      )
                    }
                    type="button"
                  >
                    Liberar premio
                  </button>
                </>
              ) : openSession ? (
                <button
                  className="button button--primary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        reserveReward({
                          rewardId: reward.rewardId,
                          sessionId: openSession.sessionId
                        }),
                      "Reservamos el premio. Avisale al mozo para cobrar con descuento."
                    )
                  }
                  type="button"
                >
                  Usar en mi cuenta
                </button>
              ) : (
                <small> Se usa cuando tengas una cuenta abierta en una mesa.</small>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () => saveBirthday({ day: Number(day), month: Number(month) }),
            "Guardamos tu cumpleaños."
          );
        }}
      >
        <h3>Tu cumpleaños</h3>
        <label>
          Día
          <input
            inputMode="numeric"
            max={31}
            min={1}
            onChange={(event) => setDay(event.target.value)}
            type="number"
            value={day}
          />
        </label>
        <label>
          Mes
          <select
            onChange={(event) => setMonth(event.target.value)}
            value={month}
          >
            {months.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--secondary"
          disabled={busy}
          type="submit"
        >
          Guardar cumpleaños
        </button>
      </form>

      {message ? (
        <p
          className={`form-message ${message.error ? "form-message--error" : "form-message--success"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
