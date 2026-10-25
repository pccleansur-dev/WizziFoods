"use client";

import { useCallback, useEffect, useState } from "react";

import {
  linkToSession,
  loadAvailability,
  loadMe,
  logout,
  saveProfile
} from "./diner-client";

type BarState =
  | { kind: "hidden" }
  | { kind: "guest" }
  | { kind: "needs-profile" }
  | { displayName: string; kind: "member" };

const dismissedKey = "diner-account-dismissed";

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(dismissedKey) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    window.sessionStorage.setItem(dismissedKey, "1");
  } catch {
    // The prompt just comes back on the next visit.
  }
}

type PromptProps = {
  dismissed: boolean;
  nextPath: string;
  onDismiss: () => void;
};

/**
 * The optional Google login. It never replaces the menu: «Continuar sin cuenta» is
 * always there and the menu below does not wait for any of this.
 */
export function GuestPrompt({ dismissed, nextPath, onDismiss }: PromptProps) {
  const login = (label: string, className: string) => (
    <form action="/api/diner/login" method="post">
      <input name="next" type="hidden" value={nextPath} />
      <button className={className} type="submit">
        {label}
      </button>
    </form>
  );
  if (dismissed) {
    return (
      <aside
        aria-label="Cuenta opcional"
        className="diner-account diner-account--quiet"
      >
        {login("Ingresar con Google (opcional)", "diner-account__link")}
      </aside>
    );
  }
  return (
    <aside aria-label="Cuenta opcional" className="diner-account">
      <p className="diner-account__text">
        <strong>¿Querés guardar tus datos en este local?</strong> Ingresar con
        Google es opcional: podés pedir igual sin cuenta.
      </p>
      <div className="diner-account__actions">
        {login("Ingresar con Google", "button button--primary")}
        <button
          className="button button--secondary"
          onClick={onDismiss}
          type="button"
        >
          Continuar sin cuenta
        </button>
      </div>
    </aside>
  );
}

export function DinerAccountBar({ token }: { token: string }) {
  const nextPath = `/m/${token}`;
  const [state, setState] = useState<BarState>({ kind: "hidden" });
  const [dismissed, setDismissed] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const me = await loadMe();
    if (me.ok) {
      setState(
        me.value.profile
          ? { displayName: me.value.profile.displayName, kind: "member" }
          : { kind: "needs-profile" }
      );
      return;
    }
    if (me.status !== 401) return;
    setDismissed(readDismissed());
    setState(
      (await loadAvailability()) ? { kind: "guest" } : { kind: "hidden" }
    );
  }, []);

  useEffect(() => {
    // Deferred so the menu paints first and the account check never delays it.
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // A member joins the open session of the table; it never blocks anything.
  useEffect(() => {
    if (state.kind !== "member") return;
    const link = () => {
      if (document.visibilityState === "visible") void linkToSession(token);
    };
    link();
    document.addEventListener("visibilitychange", link);
    const timer = window.setInterval(link, 15_000);
    return () => {
      document.removeEventListener("visibilitychange", link);
      window.clearInterval(timer);
    };
  }, [state.kind, token]);

  if (state.kind === "hidden") return null;
  if (state.kind === "guest") {
    return (
      <GuestPrompt
        dismissed={dismissed}
        nextPath={nextPath}
        onDismiss={() => {
          writeDismissed();
          setDismissed(true);
        }}
      />
    );
  }
  if (state.kind === "needs-profile") {
    return (
      <aside aria-label="Tu cuenta" className="diner-account">
        <p className="diner-account__text">
          <strong>Ingresaste con Google.</strong> Contanos cómo te llamamos en
          este local (no compartimos tu correo).
        </p>
        <form
          className="diner-account__actions"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void saveProfile({ displayName: name, whatsappPhone: null }).then(
              (outcome) => {
                setBusy(false);
                if (outcome.ok) {
                  setMessage(null);
                  void refresh();
                } else {
                  setMessage(outcome.message);
                }
              }
            );
          }}
        >
          <input
            aria-label="Tu nombre en este local"
            autoComplete="given-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
          <button
            className="button button--primary"
            disabled={busy || name.trim() === ""}
            type="submit"
          >
            Crear mi perfil
          </button>
        </form>
        {message ? (
          <p className="form-message form-message--error">{message}</p>
        ) : null}
      </aside>
    );
  }
  return (
    <aside
      aria-label="Tu cuenta"
      className="diner-account diner-account--quiet"
    >
      <span>Hola, {state.displayName}</span>
      <a
        className="diner-account__link"
        href={`/cuenta?volver=${encodeURIComponent(nextPath)}`}
      >
        Mi cuenta
      </a>
      <button
        className="diner-account__link"
        onClick={() => {
          void logout().then(() => {
            setState({ kind: "hidden" });
            void refresh();
          });
        }}
        type="button"
      >
        Salir
      </button>
    </aside>
  );
}
