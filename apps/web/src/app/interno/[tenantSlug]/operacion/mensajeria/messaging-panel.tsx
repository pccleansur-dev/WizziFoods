"use client";

import type {
  MessagingAudienceMember,
  MessagingAutomation,
  MessagingEvent,
  MessagingOverview,
  MessagingTemplate
} from "@platform/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  approvalLabels,
  automationLabels,
  automationStatusLabels,
  categoryLabels,
  costLabel,
  eventLabels,
  reasonLabel,
  whenLabel
} from "../../../../../staff/messaging-view";
import {
  connectWhatsappAction,
  decideAutomationAction,
  decideOneOffAction,
  disconnectWhatsappAction,
  getMessagingAction,
  getMessagingAudienceAction,
  getMessagingEventsAction,
  proposeOneOffAction,
  saveAutomationAction,
  setSendingAction,
  setTemplateCostAction,
  syncTemplatesAction
} from "../messaging-actions";
import type { WaiterActionResult } from "../waiter-action-result";

type Draft = {
  accessToken: string;
  displayPhone: string;
  phoneNumberId: string;
  wabaId: string;
};

const emptyDraft: Draft = {
  accessToken: "",
  displayPhone: "",
  phoneNumberId: "",
  wabaId: ""
};

function approvedTemplates(templates: MessagingTemplate[]) {
  return templates.filter((template) => template.approvalStatus === "approved");
}

/**
 * The Encargado's messaging screen: connection, templates, the four permanent
 * automations (approved once), one-off events (confirmed each time) and the log.
 * The access token is typed here once and is never shown or returned again.
 */
export function MessagingPanel({ tenantSlug }: { tenantSlug: string }) {
  const [overview, setOverview] = useState<MessagingOverview | null>(null);
  const [events, setEvents] = useState<MessagingEvent[]>([]);
  const [audience, setAudience] = useState<MessagingAudienceMember[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [oneOffTemplate, setOneOffTemplate] = useState("");
  const [oneOffPeople, setOneOffPeople] = useState<string[]>([]);
  const [oneOffText, setOneOffText] = useState("");

  const refreshLog = useCallback(async () => {
    const result = await getMessagingEventsAction(tenantSlug);
    if (result.status === "ok") setEvents(result.data);
  }, [tenantSlug]);

  useEffect(() => {
    void getMessagingAction(tenantSlug).then((result) => {
      if (result.status === "ok") setOverview(result.data);
      else setMessage(result.message);
    });
    void getMessagingAudienceAction(tenantSlug).then((result) => {
      if (result.status === "ok") setAudience(result.data);
    });
    void getMessagingEventsAction(tenantSlug).then((result) => {
      if (result.status === "ok") setEvents(result.data);
    });
  }, [tenantSlug]);

  async function apply(
    work: () => Promise<WaiterActionResult<MessagingOverview>>,
    done: string
  ) {
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (result.status === "ok") {
      setOverview(result.data);
      setMessage(done);
      void refreshLog();
    } else {
      setMessage(result.message);
    }
  }

  if (!overview) {
    return message ? (
      <p className="waiter-notice waiter-notice--error" role="alert">
        {message}
      </p>
    ) : (
      <p>Cargando…</p>
    );
  }

  const connection = overview.connection;
  const approved = approvedTemplates(overview.templates);

  async function connect() {
    const request = {
      accessToken: draft.accessToken.trim(),
      displayPhone:
        draft.displayPhone.trim() === "" ? null : draft.displayPhone.trim(),
      phoneNumberId: draft.phoneNumberId.trim(),
      wabaId: draft.wabaId.trim()
    };
    await apply(
      () => connectWhatsappAction(tenantSlug, request),
      "Conectamos el número."
    );
    setDraft(emptyDraft);
    void getMessagingAudienceAction(tenantSlug).then((result) => {
      if (result.status === "ok") setAudience(result.data);
    });
  }

  async function propose() {
    setBusy(true);
    const result = await proposeOneOffAction(tenantSlug, {
      commandId: crypto.randomUUID(),
      profileIds: oneOffPeople,
      templateId: oneOffTemplate,
      variables: oneOffText.trim() === "" ? [] : [oneOffText.trim()]
    });
    if (result.status === "ok") {
      const refreshed = await getMessagingAction(tenantSlug);
      if (refreshed.status === "ok") setOverview(refreshed.data);
      setOneOffPeople([]);
      setMessage(
        "Preparamos el envío. Todavía no salió nada: confirmalo abajo."
      );
    } else {
      setMessage(result.message);
    }
    setBusy(false);
  }

  async function decideOneOff(batchId: string, decision: "cancel" | "confirm") {
    setBusy(true);
    const result = await decideOneOffAction(tenantSlug, batchId, { decision });
    if (result.status === "ok") {
      const refreshed = await getMessagingAction(tenantSlug);
      if (refreshed.status === "ok") setOverview(refreshed.data);
      setMessage(
        decision === "confirm"
          ? "Confirmaste el envío. Se manda respetando horarios, topes y bajas."
          : "Cancelaste el envío."
      );
      void refreshLog();
    } else {
      setMessage(result.message);
    }
    setBusy(false);
  }

  function automationActions(automation: MessagingAutomation) {
    const decide = (decision: "approve" | "pause" | "resume", done: string) =>
      automation.id
        ? apply(
            () =>
              decideAutomationAction(tenantSlug, automation.id!, { decision }),
            done
          )
        : Promise.resolve();
    return (
      <>
        {automation.status === "pending_approval" ? (
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() =>
              void decide("approve", "Aprobaste la automatización.")
            }
            type="button"
          >
            Aprobar {automationLabels[automation.kind]}
          </button>
        ) : null}
        {automation.status === "approved" ? (
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => void decide("pause", "Pausaste la automatización.")}
            type="button"
          >
            Pausar {automationLabels[automation.kind]}
          </button>
        ) : null}
        {automation.status === "paused" ? (
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() =>
              void decide("resume", "Reanudaste la automatización.")
            }
            type="button"
          >
            Reanudar {automationLabels[automation.kind]}
          </button>
        ) : null}
      </>
    );
  }

  const oneOffTemplates = approved;
  const people = audience.filter((person) => {
    const template = approved.find((entry) => entry.id === oneOffTemplate);
    return template?.category === "operational"
      ? person.whatsappConsent
      : person.marketingConsent;
  });

  return (
    <div className="messaging-panel">
      <p className="waiter-note">
        Los mensajes salen solo con el consentimiento vigente de cada persona,
        de 10 a 20 h para promociones, con un máximo de 2 por semana y 8 por
        mes, y se frenan si la persona responde BAJA.
      </p>
      {message !== null ? (
        <p aria-live="polite" className="waiter-note" role="status">
          {message}
        </p>
      ) : null}

      <section aria-label="Conexión de WhatsApp" className="waiter-reject">
        <h2>Conexión de WhatsApp</h2>
        {connection ? (
          <>
            <p>
              Número conectado:{" "}
              <strong>{connection.displayPhone ?? "sin número visible"}</strong>{" "}
              (ID {connection.phoneNumberId})
            </p>
            <label>
              <input
                checked={connection.sendingEnabled}
                disabled={busy}
                onChange={(event) =>
                  void apply(
                    () => setSendingAction(tenantSlug, event.target.checked),
                    event.target.checked
                      ? "Activaste los envíos."
                      : "Apagaste los envíos."
                  )
                }
                type="checkbox"
              />{" "}
              Envíos activados
            </label>
            {!connection.sendingEnabled ? (
              <p className="waiter-note">
                Los envíos están apagados: nada sale hasta que los actives, algo
                que conviene hacer recién después de la revisión legal y
                comercial.
              </p>
            ) : null}
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() =>
                void apply(
                  () => syncTemplatesAction(tenantSlug),
                  "Actualizamos las plantillas."
                )
              }
              type="button"
            >
              Sincronizar plantillas
            </button>{" "}
            {confirmDisconnect ? (
              <>
                <button
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => {
                    setConfirmDisconnect(false);
                    void apply(
                      () => disconnectWhatsappAction(tenantSlug),
                      "Desconectamos el número."
                    );
                  }}
                  type="button"
                >
                  Sí, desconectar
                </button>{" "}
                <button
                  className="button button--secondary"
                  onClick={() => setConfirmDisconnect(false)}
                  type="button"
                >
                  No
                </button>
              </>
            ) : (
              <button
                className="button button--secondary"
                onClick={() => setConfirmDisconnect(true)}
                type="button"
              >
                Desconectar número
              </button>
            )}
          </>
        ) : (
          <>
            <p>
              Cargá los datos de tu cuenta de WhatsApp Business. El token se
              guarda sellado y no vuelve a mostrarse.
            </p>
            <label htmlFor="wa-phone-id">ID del número de teléfono</label>
            <input
              id="wa-phone-id"
              inputMode="numeric"
              onChange={(event) =>
                setDraft({ ...draft, phoneNumberId: event.target.value })
              }
              value={draft.phoneNumberId}
            />
            <label htmlFor="wa-waba">
              ID de la cuenta de WhatsApp Business
            </label>
            <input
              id="wa-waba"
              inputMode="numeric"
              onChange={(event) =>
                setDraft({ ...draft, wabaId: event.target.value })
              }
              value={draft.wabaId}
            />
            <label htmlFor="wa-display">
              Número visible (opcional, ej. +5491122334455)
            </label>
            <input
              id="wa-display"
              onChange={(event) =>
                setDraft({ ...draft, displayPhone: event.target.value })
              }
              value={draft.displayPhone}
            />
            <label htmlFor="wa-token">Token de acceso</label>
            <input
              autoComplete="off"
              id="wa-token"
              onChange={(event) =>
                setDraft({ ...draft, accessToken: event.target.value })
              }
              type="password"
              value={draft.accessToken}
            />
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void connect()}
              type="button"
            >
              Conectar WhatsApp
            </button>
          </>
        )}
      </section>

      {connection ? (
        <>
          <section aria-label="Plantillas" className="waiter-reject">
            <h2>Plantillas</h2>
            <p>
              Uso del mes: {overview.usage.sentThisMonth} mensajes, costo
              estimado {costLabel(overview.usage.estimatedCostCents)}.
            </p>
            <ul>
              {overview.templates.map((template) => (
                <li key={template.id}>
                  <strong>{template.name}</strong> ·{" "}
                  {categoryLabels[template.category]} ·{" "}
                  {approvalLabels[template.approvalStatus]}
                  <br />
                  <small>{template.body}</small>
                  <br />
                  <label htmlFor={`cost-${template.id}`}>
                    Costo estimado por mensaje (centavos)
                  </label>{" "}
                  <input
                    id={`cost-${template.id}`}
                    inputMode="decimal"
                    onChange={(event) =>
                      setCosts({ ...costs, [template.id]: event.target.value })
                    }
                    value={
                      costs[template.id] ?? String(template.estimatedCostCents)
                    }
                  />{" "}
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() =>
                      void apply(
                        () =>
                          setTemplateCostAction(
                            tenantSlug,
                            template.id,
                            Number(
                              costs[template.id] ?? template.estimatedCostCents
                            )
                          ),
                        "Guardamos el costo."
                      )
                    }
                    type="button"
                  >
                    Guardar costo de {template.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Automatizaciones" className="waiter-reject">
            <h2>Automatizaciones</h2>
            <p>
              Cada una se aprueba una sola vez y después corre sola. Si cambiás
              la plantilla, hay que aprobarla de nuevo.
            </p>
            <ul>
              {overview.automations.map((automation) => (
                <li key={automation.kind}>
                  <strong>{automationLabels[automation.kind]}</strong> ·{" "}
                  {automationStatusLabels[automation.status]}
                  {automation.templateName
                    ? ` · ${automation.templateName}`
                    : ""}
                  <br />
                  <label htmlFor={`auto-${automation.kind}`}>
                    Plantilla de {automationLabels[automation.kind]}
                  </label>{" "}
                  <select
                    id={`auto-${automation.kind}`}
                    onChange={(event) =>
                      setChosen({
                        ...chosen,
                        [automation.kind]: event.target.value
                      })
                    }
                    value={
                      chosen[automation.kind] ?? automation.templateId ?? ""
                    }
                  >
                    <option value="">Elegí una plantilla aprobada</option>
                    {approved.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({categoryLabels[template.category]})
                      </option>
                    ))}
                  </select>{" "}
                  <button
                    className="button button--secondary"
                    disabled={
                      busy ||
                      !(chosen[automation.kind] ?? automation.templateId)
                    }
                    onClick={() =>
                      void apply(
                        () =>
                          saveAutomationAction(tenantSlug, {
                            kind: automation.kind,
                            templateId: (chosen[automation.kind] ??
                              automation.templateId)!
                          }),
                        "Guardamos la plantilla. Falta aprobarla."
                      )
                    }
                    type="button"
                  >
                    Guardar plantilla de {automationLabels[automation.kind]}
                  </button>{" "}
                  {automationActions(automation)}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Evento puntual" className="waiter-reject">
            <h2>Evento puntual</h2>
            <p>
              Una promoción, un show o un aviso único. Se prepara acá y no sale
              hasta que lo confirmes.
            </p>
            <label htmlFor="oneoff-template">Plantilla del evento</label>
            <select
              id="oneoff-template"
              onChange={(event) => {
                setOneOffTemplate(event.target.value);
                setOneOffPeople([]);
              }}
              value={oneOffTemplate}
            >
              <option value="">Elegí una plantilla aprobada</option>
              {oneOffTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({categoryLabels[template.category]})
                </option>
              ))}
            </select>
            <label htmlFor="oneoff-text">
              Texto de la variable {"{{1}}"} (opcional)
            </label>
            <input
              id="oneoff-text"
              onChange={(event) => setOneOffText(event.target.value)}
              value={oneOffText}
            />
            <fieldset>
              <legend>Personas con consentimiento para esta plantilla</legend>
              {people.length === 0 ? (
                <p>No hay personas con consentimiento para esta plantilla.</p>
              ) : (
                people.map((person) => (
                  <label key={person.profileId} style={{ display: "block" }}>
                    <input
                      checked={oneOffPeople.includes(person.profileId)}
                      onChange={(event) =>
                        setOneOffPeople(
                          event.target.checked
                            ? [...oneOffPeople, person.profileId]
                            : oneOffPeople.filter(
                                (id) => id !== person.profileId
                              )
                        )
                      }
                      type="checkbox"
                    />{" "}
                    {person.displayName}
                  </label>
                ))
              )}
            </fieldset>
            <button
              className="button button--primary"
              disabled={
                busy || oneOffTemplate === "" || oneOffPeople.length === 0
              }
              onClick={() => void propose()}
              type="button"
            >
              Preparar envío
            </button>
            {overview.oneOffEvents.map((event) => (
              <div className="waiter-note" key={event.batchId} role="group">
                <p>
                  Envío preparado con «{event.templateName}» para{" "}
                  {event.recipients}{" "}
                  {event.recipients === 1 ? "persona" : "personas"}. Falta tu
                  confirmación.
                </p>
                <button
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => void decideOneOff(event.batchId, "confirm")}
                  type="button"
                >
                  Confirmar envío
                </button>{" "}
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => void decideOneOff(event.batchId, "cancel")}
                  type="button"
                >
                  Cancelar envío
                </button>
              </div>
            ))}
          </section>
        </>
      ) : null}

      <section aria-label="Registro de envíos" className="waiter-reject">
        <h2>Registro de envíos</h2>
        <button
          className="button button--secondary"
          onClick={() => void refreshLog()}
          type="button"
        >
          Actualizar registro
        </button>
        {events.length === 0 ? (
          <p>Todavía no hay movimientos.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">Persona</th>
                <th scope="col">Plantilla</th>
                <th scope="col">Estado</th>
                <th scope="col">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{whenLabel(event.occurredAt)}</td>
                  <td>{event.displayName ?? ""}</td>
                  <td>{event.templateName ?? ""}</td>
                  <td>{eventLabels[event.kind]}</td>
                  <td>{reasonLabel(event.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
