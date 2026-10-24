"use client";

import {
  parseWaiterSalonView,
  type WaiterOrderResult,
  type WaiterSalonView
} from "@platform/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WaiterMenuProduct } from "../../../../../staff/waiter-view";
import { waiterErrorMessage } from "../../../../../staff/waiter-view";
import {
  claimCallAction,
  createManualOrderAction,
  decideIntentAction
} from "../waiter-actions";
import type { WaiterActionResult } from "../waiter-action-result";
import { ConfirmedOrderPanel } from "./confirmed-order-panel";
import { ManualOrderForm, type ManualOrderDraft } from "./manual-order-form";
import { WaiterPending } from "./waiter-pending";
import { WaiterTables } from "./waiter-tables";
import { newId } from "../../../../../lib/new-id";

const POLL_MS = 5_000;

type Notice = { kind: "error" | "ok"; text: string };
type Tab = "comanda" | "salon";

export function WaiterWorkspace({
  canCreateOrders,
  canValidate,
  initialTab,
  initialView,
  isManager,
  menu,
  tenantSlug
}: {
  canCreateOrders: boolean;
  canValidate: boolean;
  initialTab: Tab;
  initialView: WaiterSalonView;
  isManager: boolean;
  menu: WaiterMenuProduct[];
  tenantSlug: string;
}) {
  const [view, setView] = useState(initialView);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [stale, setStale] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmed, setConfirmed] = useState<{
    order: WaiterOrderResult;
    tableLabel: string;
  } | null>(null);
  const [now, setNow] = useState(() => Date.parse(initialView.generatedAt));
  // One command id per distinct payload: a retry after an unknown outcome reuses
  // it (idempotent), while a changed payload gets a fresh one.
  const commands = useRef(new Map<string, string>());

  const commandFor = useCallback((key: string) => {
    const existing = commands.current.get(key);
    if (existing) return existing;
    const created = newId();
    commands.current.set(key, created);
    return created;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/interno/${tenantSlug}/operacion/vista`, {
        cache: "no-store"
      });
      if (response.status === 401) {
        setExpired(true);
        return;
      }
      if (!response.ok) throw new Error("salon unavailable");
      const parsed = parseWaiterSalonView(await response.json());
      if (!parsed) throw new Error("salon invalid");
      setView(parsed);
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

  async function perform<T>(
    key: string,
    action: (commandId: string) => Promise<WaiterActionResult<T>>
  ): Promise<WaiterActionResult<T>> {
    setBusy(key);
    setNotice(null);
    const result = await action(commandFor(key));
    if (result.status === "ok") commands.current.delete(key);
    // A definitive refusal (state conflict) must not poison a later attempt.
    if (result.status === "error" && result.code !== null) {
      commands.current.delete(key);
    }
    if (result.status === "error" && result.code === "STAFF_SESSION_INVALID") {
      setExpired(true);
    }
    await refresh();
    setBusy(null);
    return result;
  }

  async function claim(callId: string) {
    const result = await perform(`claim:${callId}`, (commandId) =>
      claimCallAction(tenantSlug, callId, commandId)
    );
    setNotice(
      result.status === "ok"
        ? { kind: "ok", text: "Tomaste el llamado." }
        : { kind: "error", text: result.message }
    );
  }

  async function confirm(intentId: string) {
    const tableLabel =
      view.intents.find((intent) => intent.id === intentId)?.tableLabel ?? "";
    const result = await perform(`confirm:${intentId}`, (commandId) =>
      decideIntentAction(tenantSlug, intentId, {
        commandId,
        decision: "confirm",
        reason: null
      })
    );
    if (result.status === "ok" && result.data.decision === "confirmed") {
      setConfirmed({
        order: result.data.order,
        tableLabel: tableLabel ? `Mesa ${tableLabel}` : "Mesa"
      });
      setNotice(null);
    } else if (result.status === "error") {
      setNotice({ kind: "error", text: result.message });
    }
  }

  async function reject(intentId: string, reason: string) {
    const result = await perform(`reject:${intentId}:${reason}`, (commandId) =>
      decideIntentAction(tenantSlug, intentId, {
        commandId,
        decision: "reject",
        reason
      })
    );
    setNotice(
      result.status === "ok"
        ? { kind: "ok", text: "Pedido rechazado." }
        : { kind: "error", text: result.message }
    );
  }

  async function createOrder(draft: ManualOrderDraft): Promise<boolean> {
    const result = await perform(
      `manual:${JSON.stringify(draft)}`,
      (commandId) =>
        createManualOrderAction(tenantSlug, { ...draft, commandId })
    );
    if (result.status === "ok") {
      const table = view.units
        .flatMap((unit) => unit.tables)
        .find((entry) => entry.id === draft.tableId);
      setConfirmed({
        order: result.data,
        tableLabel: table ? `Mesa ${table.label}` : "Mesa"
      });
      return true;
    }
    setNotice({ kind: "error", text: result.message });
    return false;
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

  const tables = view.units
    .flatMap((unit) => unit.tables)
    .filter((table) => table.inScope)
    .map((table) => ({ id: table.id, label: table.label }));
  const openCalls = view.calls.length;

  return (
    <div className="waiter-workspace">
      <p aria-live="polite" className="waiter-status" role="status">
        {openCalls === 0
          ? "Sin llamados abiertos."
          : `${openCalls} llamado${openCalls === 1 ? "" : "s"} abierto${openCalls === 1 ? "" : "s"}.`}{" "}
        {stale
          ? "Sin conexión con el servidor: se muestra la última lectura."
          : "Se actualiza solo."}
      </p>

      <nav aria-label="Vistas del salón" className="waiter-tabs">
        <button
          aria-pressed={tab === "salon"}
          onClick={() => setTab("salon")}
          type="button"
        >
          Salón y llamados
        </button>
        {canCreateOrders ? (
          <button
            aria-pressed={tab === "comanda"}
            onClick={() => setTab("comanda")}
            type="button"
          >
            Cargar comanda
          </button>
        ) : null}
      </nav>

      {notice ? (
        <p
          className={`waiter-notice waiter-notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      {confirmed ? (
        <ConfirmedOrderPanel
          onDismiss={() => setConfirmed(null)}
          order={confirmed.order}
          tableLabel={confirmed.tableLabel}
        />
      ) : null}

      {tab === "salon" ? (
        <>
          {canValidate ? (
            <WaiterPending
              busy={busy}
              calls={view.calls}
              canOverrideClaim={isManager}
              intents={view.intents}
              now={now}
              onClaim={(callId) => void claim(callId)}
              onConfirm={(intentId) => void confirm(intentId)}
              onReject={(intentId, reason) => void reject(intentId, reason)}
            />
          ) : null}
          <WaiterTables view={view} />
        </>
      ) : (
        <ManualOrderForm
          busy={busy !== null}
          menu={menu}
          onSubmit={createOrder}
          tables={tables}
        />
      )}
    </div>
  );
}
