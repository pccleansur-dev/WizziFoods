"use client";

import {
  parseDinerSplitView,
  type DinerShare,
  type DinerSplitView
} from "@platform/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatMoney } from "./diner-catalog-format";

const POLL_MS = 5_000;

/** A secret only this phone knows: it proves which reserved shares are its own. */
function deviceSecret(token: string): string {
  const key = `split-secret:${token}`;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored && /^[0-9A-Za-z_-]{43}$/u.test(stored)) return stored;
  } catch {
    // Private mode: the secret lives only as long as the page.
  }
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const secret = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  try {
    window.localStorage.setItem(key, secret);
  } catch {
    // Ignored: see above.
  }
  return secret;
}

function describe(share: DinerShare): string {
  if (share.status === "paid") return "Pagada";
  if (share.status === "claimed") {
    return share.mine ? "La tomaste vos" : `La tomó ${share.claimedBy}`;
  }
  return "Libre";
}

export function DinerSplit({ token }: { token: string }) {
  const secret = useRef<string | null>(null);
  const [view, setView] = useState<DinerSplitView | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const call = useCallback(
    async (action: "claim" | "release" | "view", extra: object = {}) => {
      secret.current ??= deviceSecret(token);
      const response = await fetch(`/api/account-splits/${action}`, {
        body: JSON.stringify({ secret: secret.current, token, ...extra }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = (await response.json().catch(() => null)) as {
        data?: unknown;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "No pudimos completar la acción.");
      }
      const parsed = parseDinerSplitView(body?.data);
      if (!parsed) throw new Error("Respuesta inválida.");
      setView(parsed);
    },
    [token]
  );

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped && document.visibilityState === "visible") {
        void call("view").catch(() => undefined);
      }
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [call]);

  async function act(action: "claim" | "release", position: number) {
    setBusy(true);
    setMessage(null);
    try {
      await call(
        action,
        action === "claim" ? { label: name.trim(), position } : { position }
      );
    } catch (error) {
      setMessage((error as Error).message);
      await call("view").catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <p role="status">Cargando la cuenta…</p>;
  if (!view.split) {
    return (
      <section aria-labelledby="split-title" className="diner-empty">
        <h2 id="split-title">Dividir la cuenta</h2>
        <p>
          Todavía no se dividió la cuenta de tu mesa. Pedile al mozo que la
          divida y vas a poder elegir tu parte desde acá.
        </p>
      </section>
    );
  }
  const split = view.split;
  return (
    <section aria-labelledby="split-title" className="diner-split">
      <h2 id="split-title">Tu parte de la cuenta</h2>
      <p>Elegí tu parte y avisale al mozo: la cobra en la mesa.</p>
      <label htmlFor="split-name">Tu nombre</label>
      <input
        autoComplete="given-name"
        id="split-name"
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        value={name}
      />
      {message ? <p role="alert">{message}</p> : null}
      <ul aria-label="Partes de la cuenta" className="diner-split-list">
        {split.shares.map((share) => (
          <li key={share.position}>
            <div>
              <strong>Parte {share.position}</strong> · {formatMoney(share.amountCents)}
              <br />
              <small>
                {describe(share)}
                {share.items.length > 0 ? ` · ${share.items.join(", ")}` : ""}
              </small>
            </div>
            {share.status === "open" ? (
              <button
                aria-label={`Tomar la parte ${share.position}`}
                className="button button--primary"
                disabled={busy || name.trim() === ""}
                onClick={() => void act("claim", share.position)}
                type="button"
              >
                Tomar
              </button>
            ) : share.status === "claimed" && share.mine ? (
              <button
                aria-label={`Soltar la parte ${share.position}`}
                className="button button--secondary"
                disabled={busy}
                onClick={() => void act("release", share.position)}
                type="button"
              >
                Soltar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="diner-note">
        Nadie te pide datos de tarjeta acá: el mozo cobra tu parte en la mesa.
      </p>
    </section>
  );
}
