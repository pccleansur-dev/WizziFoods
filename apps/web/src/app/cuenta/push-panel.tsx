"use client";

import { useEffect, useState } from "react";

import {
  currentlySubscribed,
  disablePush,
  enablePush,
  loadPushConfig,
  pushSupport,
  type PushSupport
} from "../diner-account/push-client";

type State =
  | { kind: "hidden" }
  | {
      kind: "loaded";
      publicKey: string;
      subscribed: boolean;
      support: PushSupport;
    };

/**
 * Notifications of this restaurant on this device. Entirely optional and loaded after
 * the rest of the account screen: the menu never waits for it, and it shows nothing
 * where the restaurant or the browser does not offer them.
 */
export function PushPanel() {
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadPushConfig().then(async (config) => {
      if (!alive || !config?.available || !config.publicKey) return;
      const support = pushSupport();
      const subscribed =
        support === "ready" ? await currentlySubscribed() : false;
      if (alive) {
        setState({
          kind: "loaded",
          publicKey: config.publicKey,
          subscribed,
          support
        });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "hidden") return null;
  const loaded = state;
  const { publicKey, subscribed, support } = loaded;

  async function turnOn() {
    setBusy(true);
    const outcome = await enablePush(publicKey);
    setBusy(false);
    if (outcome === "ok") {
      setState({ ...loaded, subscribed: true, support: "ready" });
      setMessage("Listo: te avisaremos en este dispositivo.");
    } else if (outcome === "denied") {
      setState({ ...loaded, support: "denied" });
      setMessage(
        "No diste permiso. Podés cambiarlo en los ajustes del navegador."
      );
    } else {
      setMessage("No pudimos activar los avisos. Intentá de nuevo.");
    }
  }

  async function turnOff() {
    setBusy(true);
    const ok = await disablePush();
    setBusy(false);
    if (ok) {
      setState({ ...loaded, subscribed: false });
      setMessage("Desactivamos los avisos en este dispositivo.");
    } else {
      setMessage("No pudimos desactivarlos. Intentá de nuevo.");
    }
  }

  return (
    <section
      aria-label="Avisos en este dispositivo"
      className="diner-account-panel__push"
    >
      <h2>Avisos en este dispositivo</h2>
      <p>
        Te avisamos cuando ganás un premio o está por vencer. Las promociones
        solo te llegan si además aceptaste recibirlas arriba.
      </p>
      {support === "ios-needs-install" ? (
        <p>
          En iPhone, primero agregá esta página a tu pantalla de inicio
          (Compartir → «Agregar a pantalla de inicio») y volvé a entrar desde
          ahí.
        </p>
      ) : null}
      {support === "unsupported" ? (
        <p>Este navegador no permite avisos.</p>
      ) : null}
      {support === "denied" ? (
        <p>
          Bloqueaste los avisos en este navegador. Podés permitirlos desde sus
          ajustes.
        </p>
      ) : null}
      {support === "ready" ? (
        subscribed ? (
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => void turnOff()}
            type="button"
          >
            Desactivar avisos
          </button>
        ) : (
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void turnOn()}
            type="button"
          >
            Activar avisos
          </button>
        )
      ) : null}
      {message !== null ? (
        <p aria-live="polite" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
