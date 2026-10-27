"use client";

import {
  parseProductionBoard,
  type ProductionBoard,
  type ProductionTicketItem
} from "@platform/contracts";
import { useCallback, useRef, useState } from "react";

import {
  nextProductionStep,
  productionStatusLabel,
  sortProductionTickets
} from "../../../../../staff/production-view";
import { waiterErrorMessage } from "../../../../../staff/waiter-view";
import { reportProductionExceptionAction } from "../order-adjustment-actions";
import { advanceProductionItemAction } from "../production-actions";
import { ConnectionBanner } from "../../../../../lib/connection-banner";
import { OFFLINE_ACTION_MESSAGE } from "../../../../../lib/connection-view";
import { newId } from "../../../../../lib/new-id";
import { settleAction } from "../../../../../lib/settle-action";
import { useLiveSync } from "../../../../../lib/use-live-sync";

type Notice = { kind: "error" | "ok"; text: string };

const sectorTitles = { bar: "Barra", kitchen: "Cocina" } as const;

function ageLabel(confirmedAt: string, now: number): string {
  const minutes = Math.max(
    0,
    Math.floor((now - Date.parse(confirmedAt)) / 60_000)
  );
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

export function ProductionBoardView({
  initialBoard,
  tenantSlug
}: {
  initialBoard: ProductionBoard;
  tenantSlug: string;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [stale, setStale] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Date.parse(initialBoard.generatedAt));
  // One command id per item and target: a retry after an unknown outcome or a
  // reconnection reuses it, so the server answers with the stored result.
  const commands = useRef(new Map<string, string>());

  // Only the latest refresh started may write: an older answer never overwrites a newer one.
  const latestRefresh = useRef(0);
  const refresh = useCallback(async (): Promise<boolean> => {
    const mine = (latestRefresh.current += 1);
    try {
      const response = await fetch(
        `/interno/${tenantSlug}/operacion/produccion/vista`,
        { cache: "no-store" }
      );
      if (response.status === 401) {
        setExpired(true);
        return true;
      }
      if (!response.ok) throw new Error("board unavailable");
      const parsed = parseProductionBoard(await response.json());
      if (!parsed) throw new Error("board invalid");
      if (mine !== latestRefresh.current) return true;
      setBoard(parsed);
      setStale(false);
      setNow(Date.now());
      return true;
    } catch {
      setStale(true);
      return false;
    }
  }, [tenantSlug]);

  const live = useLiveSync({
    endpoint: `/interno/${tenantSlug}/operacion/tiempo-real`,
    refresh
  });

  async function advance(
    orderId: string,
    item: ProductionTicketItem,
    target: "preparing" | "ready"
  ) {
    const key = `${item.lineId}:${target}`;
    // Nothing leaves while the device cannot reach the server; the command id is kept.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setNotice({ kind: "error", text: OFFLINE_ACTION_MESSAGE });
      return;
    }
    let commandId = commands.current.get(key);
    if (!commandId) {
      commandId = newId();
      commands.current.set(key, commandId);
    }
    setBusy(key);
    setNotice(null);
    const result = await settleAction(() =>
      advanceProductionItemAction(tenantSlug, orderId, item.lineId, {
        commandId,
        status: target
      })
    );
    // A definitive answer, success or refusal, ends the command; only an
    // unknown outcome (no code) keeps it for the retry.
    if (result.status === "ok" || result.code !== null) {
      commands.current.delete(key);
    }
    if (result.status === "error" && result.code === "STAFF_SESSION_INVALID") {
      setExpired(true);
    }
    setNotice(
      result.status === "ok"
        ? {
            kind: "ok",
            text: `${item.title}: ${productionStatusLabel(result.data.status)}.`
          }
        : { kind: "error", text: result.message }
    );
    await refresh();
    setBusy(null);
  }

  async function reportShortage(orderId: string, item: ProductionTicketItem) {
    const text = reason.trim();
    if (text.length === 0) return;
    const key = `exception:${item.lineId}:${text}`;
    let commandId = commands.current.get(key);
    if (!commandId) {
      commandId = newId();
      commands.current.set(key, commandId);
    }
    setBusy(key);
    setNotice(null);
    const result = await settleAction(() =>
      reportProductionExceptionAction(tenantSlug, orderId, item.lineId, {
        commandId,
        reason: text
      })
    );
    if (result.status === "ok" || result.code !== null) {
      commands.current.delete(key);
    }
    if (result.status === "error" && result.code === "STAFF_SESSION_INVALID") {
      setExpired(true);
    }
    if (result.status === "ok") {
      setReporting(null);
      setReason("");
    }
    setNotice(
      result.status === "ok"
        ? {
            kind: "ok",
            text: `${item.title}: faltante informado. Avisá al mozo para resolverlo.`
          }
        : { kind: "error", text: result.message }
    );
    await refresh();
    setBusy(null);
  }

  if (expired) {
    return (
      <div className="waiter-section" role="alert">
        <h2>Tu sesión venció</h2>
        <p>{waiterErrorMessage("STAFF_SESSION_INVALID")}</p>
        <a className="button button--primary" href={`/interno/${tenantSlug}`}>
          Volver a ingresar
        </a>
      </div>
    );
  }

  const tickets = sortProductionTickets(board.tickets);
  const active = tickets.filter((ticket) => ticket.status !== "ready").length;

  return (
    <div className="waiter-workspace">
      <ConnectionBanner state={live} />
      <h1>{sectorTitles[board.sector]}</h1>
      <p aria-live="polite" className="waiter-status" role="status">
        {active === 0
          ? "Sin pedidos pendientes."
          : `${active} pedido${active === 1 ? "" : "s"} pendiente${active === 1 ? "" : "s"}.`}{" "}
        {stale
          ? "Sin conexión con el servidor: se muestra la última lectura."
          : "Se actualiza solo."}
      </p>

      {notice ? (
        <p
          className={`waiter-notice waiter-notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      <ul className="waiter-list production-tickets">
        {tickets.map((ticket) => (
          <li
            className="waiter-card"
            data-status={ticket.status}
            key={ticket.orderId}
          >
            <header>
              <h2 className="production-ticket-title">
                Mesa {ticket.tableLabel}
              </h2>
              <p>
                {ticket.attribution === "individual"
                  ? `${ticket.dinerName ?? ""} · ${ticket.seatLabel ?? ""} · `
                  : ""}
                {ageLabel(ticket.confirmedAt, now)}
              </p>
              <p className="waiter-chip">
                {productionStatusLabel(ticket.status)}
              </p>
              <p className="waiter-note">
                Pedido completo: {productionStatusLabel(ticket.orderStatus)}
              </p>
            </header>
            <ul className="waiter-lines">
              {ticket.items.map((item) => {
                const step = nextProductionStep(item.status);
                const key = step ? `${item.lineId}:${step.target}` : null;
                return (
                  <li data-status={item.status} key={item.lineId}>
                    <span>
                      {item.quantity} × {item.title}
                      {item.variantTitle ? ` (${item.variantTitle})` : ""}
                      <small> · {productionStatusLabel(item.status)}</small>
                    </span>
                    {step ? (
                      <button
                        aria-label={`${step.label}: ${item.quantity} × ${item.title}, mesa ${ticket.tableLabel}`}
                        className="button button--primary"
                        disabled={busy !== null}
                        onClick={() =>
                          void advance(ticket.orderId, item, step.target)
                        }
                        type="button"
                      >
                        {busy === key ? "Guardando…" : step.label}
                      </button>
                    ) : null}
                    {step ? (
                      <button
                        aria-expanded={reporting === item.lineId}
                        aria-label={`Informar faltante: ${item.quantity} × ${item.title}, mesa ${ticket.tableLabel}`}
                        className="button button--secondary"
                        disabled={busy !== null}
                        onClick={() => {
                          setReason("");
                          setReporting(
                            reporting === item.lineId ? null : item.lineId
                          );
                        }}
                        type="button"
                      >
                        Faltante…
                      </button>
                    ) : null}
                    {step && reporting === item.lineId ? (
                      <form
                        className="waiter-reject orders-item-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void reportShortage(ticket.orderId, item);
                        }}
                      >
                        <label htmlFor={`shortage-${item.lineId}`}>
                          Motivo del faltante (obligatorio)
                        </label>
                        <textarea
                          id={`shortage-${item.lineId}`}
                          maxLength={200}
                          onChange={(event) => setReason(event.target.value)}
                          required
                          rows={2}
                          value={reason}
                        />
                        <button
                          className="button button--secondary"
                          disabled={busy !== null || reason.trim().length === 0}
                          type="submit"
                        >
                          Informar faltante
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
