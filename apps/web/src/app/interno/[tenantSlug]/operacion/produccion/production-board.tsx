"use client";

import {
  parseProductionBoard,
  type ProductionBoard,
  type ProductionTicketItem
} from "@platform/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  nextProductionStep,
  productionStatusLabel,
  sortProductionTickets
} from "../../../../../staff/production-view";
import { waiterErrorMessage } from "../../../../../staff/waiter-view";
import { advanceProductionItemAction } from "../production-actions";

const POLL_MS = 5_000;

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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Date.parse(initialBoard.generatedAt));
  // One command id per item and target: a retry after an unknown outcome or a
  // reconnection reuses it, so the server answers with the stored result.
  const commands = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/interno/${tenantSlug}/operacion/produccion/vista`,
        { cache: "no-store" }
      );
      if (response.status === 401) {
        setExpired(true);
        return;
      }
      if (!response.ok) throw new Error("board unavailable");
      const parsed = parseProductionBoard(await response.json());
      if (!parsed) throw new Error("board invalid");
      setBoard(parsed);
      setStale(false);
      setNow(Date.now());
    } catch {
      setStale(true);
    }
  }, [tenantSlug]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    async function tick() {
      if (document.visibilityState === "visible") await refresh();
      schedule();
    }
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function advance(
    orderId: string,
    item: ProductionTicketItem,
    target: "preparing" | "ready"
  ) {
    const key = `${item.lineId}:${target}`;
    let commandId = commands.current.get(key);
    if (!commandId) {
      commandId = crypto.randomUUID();
      commands.current.set(key, commandId);
    }
    setBusy(key);
    setNotice(null);
    const result = await advanceProductionItemAction(
      tenantSlug,
      orderId,
      item.lineId,
      { commandId, status: target }
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
