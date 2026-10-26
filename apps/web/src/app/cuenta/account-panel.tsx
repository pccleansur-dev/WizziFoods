"use client";

import type {
  DinerConsentKind,
  DinerConsentText,
  DinerProfileView
} from "@platform/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  backPath,
  deleteAccount,
  loadExport,
  loadMe,
  logout,
  saveProfile,
  setConsent
} from "../diner-account/diner-client";
import { LoyaltyPanel } from "./loyalty-panel";
import { PushPanel } from "./push-panel";

const consentTitles: Record<DinerConsentKind, string> = {
  marketing: "Novedades y promociones",
  whatsapp_verified: "Avisos por WhatsApp"
};

type Phase =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "ready"; view: DinerProfileView };

function textOf(texts: DinerConsentText[], kind: DinerConsentKind) {
  return texts.find((candidate) => candidate.kind === kind);
}

export function AccountPanel({ back }: { back: string }) {
  const volver = backPath(back);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const apply = useCallback((view: DinerProfileView) => {
    setPhase({ kind: "ready", view });
    setName(view.profile?.displayName ?? "");
    setPhone(view.profile?.whatsappPhone ?? "");
  }, []);

  useEffect(() => {
    void loadMe().then((outcome) => {
      if (outcome.ok) apply(outcome.value);
      else setPhase({ kind: "guest" });
    });
  }, [apply]);

  if (phase.kind === "loading") return <p>Cargando…</p>;
  if (phase.kind === "guest") {
    return (
      <div className="diner-account-panel">
        <p>No ingresaste con Google. Tu pedido no necesita una cuenta.</p>
        <form action="/api/diner/login" method="post">
          <input
            name="next"
            type="hidden"
            value={`/cuenta?volver=${encodeURIComponent(volver)}`}
          />
          <button className="button button--primary" type="submit">
            Ingresar con Google
          </button>
        </form>
        <a className="diner-account__link" href={volver}>
          Volver a la carta
        </a>
      </div>
    );
  }

  const { view } = phase;
  const report = (error: boolean, text: string) => setMessage({ error, text });

  return (
    <div className="diner-account-panel">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void saveProfile({
            displayName: name,
            whatsappPhone: phone.trim() === "" ? null : phone.trim()
          }).then((outcome) => {
            setBusy(false);
            if (outcome.ok) {
              apply(outcome.value);
              report(false, "Guardamos tu perfil.");
            } else {
              report(true, outcome.message);
            }
          });
        }}
      >
        <h2>Tu perfil en este local</h2>
        <label>
          Nombre
          <input
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label>
          Teléfono para WhatsApp (opcional, con +código de país)
          <input
            inputMode="tel"
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+5491112345678"
            value={phone}
          />
        </label>
        <button
          className="button button--primary"
          disabled={busy}
          type="submit"
        >
          Guardar perfil
        </button>
      </form>

      {view.profile ? (
        <fieldset className="diner-account-panel__consents">
          <legend>Tus permisos (siempre podés cambiarlos)</legend>
          {(["whatsapp_verified", "marketing"] as const).map((kind) => {
            const text = textOf(view.texts, kind);
            const state = view.profile?.consents[kind];
            if (!text || !state) return null;
            return (
              <label className="diner-account-panel__consent" key={kind}>
                <input
                  checked={state.granted}
                  disabled={busy}
                  onChange={(event) => {
                    setBusy(true);
                    void setConsent({
                      granted: event.target.checked,
                      kind,
                      textVersion: text.version
                    }).then((outcome) => {
                      setBusy(false);
                      if (outcome.ok) {
                        apply(outcome.value);
                        report(false, "Actualizamos tus permisos.");
                      } else {
                        report(true, outcome.message);
                      }
                    });
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>{consentTitles[kind]}</strong>
                  <small>{text.body}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <p>Guardá tu nombre para poder elegir tus permisos.</p>
      )}

      {view.profile ? <LoyaltyPanel /> : null}
      {view.profile ? <PushPanel /> : null}

      <div className="diner-account-panel__data">
        <h2>Tus datos</h2>
        <button
          className="button button--secondary"
          onClick={() => {
            void loadExport().then((outcome) => {
              if (!outcome.ok) {
                report(true, outcome.message);
                return;
              }
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(outcome.value, null, 2)], {
                  type: "application/json"
                })
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "mis-datos.json";
              link.click();
              URL.revokeObjectURL(url);
            });
          }}
          type="button"
        >
          Descargar mis datos
        </button>
        {confirmDelete ? (
          <div role="alert">
            <p>
              Se borrarán tu correo, tu nombre y tu teléfono. Tus visitas y
              pedidos quedan sin identificarte. No se puede deshacer.
            </p>
            <button
              className="button button--danger"
              onClick={() => {
                void deleteAccount().then((outcome) => {
                  if (outcome.ok) window.location.assign(volver);
                  else report(true, outcome.message);
                });
              }}
              type="button"
            >
              Sí, borrar mi cuenta
            </button>
            <button
              className="button button--secondary"
              onClick={() => setConfirmDelete(false)}
              type="button"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            className="button button--secondary"
            onClick={() => setConfirmDelete(true)}
            type="button"
          >
            Borrar mi cuenta
          </button>
        )}
      </div>

      {message ? (
        <p
          className={`form-message ${message.error ? "form-message--error" : "form-message--success"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <p>
        <a className="diner-account__link" href={volver}>
          Volver a la carta
        </a>{" "}
        <button
          className="diner-account__link"
          onClick={() => {
            void logout().then(() => window.location.assign(volver));
          }}
          type="button"
        >
          Salir
        </button>
      </p>
    </div>
  );
}
