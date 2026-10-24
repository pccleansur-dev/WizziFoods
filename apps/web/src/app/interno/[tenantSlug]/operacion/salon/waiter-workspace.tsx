"use client";

import {
  parseWaiterOrdersView,
  parseWaiterSalonView,
  type WaiterOrderResult,
  type WaiterOrdersView,
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
import {
  cancelItemAction,
  decideReplacementAction,
  deliverItemAction,
  proposeReplacementAction
} from "../order-adjustment-actions";
import type { WaiterActionResult } from "../waiter-action-result";
import { ConfirmedOrderPanel } from "./confirmed-order-panel";
import { ManualOrderForm, type ManualOrderDraft } from "./manual-order-form";
import { OrdersInProgress } from "./orders-in-progress";
import { WaiterPending } from "./waiter-pending";
import { WaiterTables } from "./waiter-tables";
import { newId } from "../../../../../lib/new-id";
import {
  attentionCount,
  differenceLabel
} from "../../../../../staff/orders-in-progress-view";

const POLL_MS = 5_000;

type Notice = { kind: "error" | "ok"; text: string };
type Tab = "comanda" | "pedidos" | "salon";

export function WaiterWorkspace({
  canCreateOrders,
  canValidate,
  initialOrders,
  initialTab,
  initialView,
  isManager,
  menu,
  tenantSlug
}: {
  canCreateOrders: boolean;
  canValidate: boolean;
  initialOrders: WaiterOrdersView;
  initialTab: Tab;
  initialView: WaiterSalonView;
  isManager: boolean;
  menu: WaiterMenuProduct[];
  tenantSlug: string;
}) {
  const [view, setView] = useState(initialView);
  const [orders, setOrders] = useState(initialOrders);
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
      const [response, ordersResponse] = await Promise.all([
        fetch(`/interno/${tenantSlug}/operacion/vista`, { cache: "no-store" }),
        fetch(`/interno/${tenantSlug}/operacion/pedidos/vista`, {
          cache: "no-store"
        })
      ]);
      if (response.status === 401 || ordersResponse.status === 401) {
        setExpired(true);
        return;
      }
      if (!response.ok || !ordersResponse.ok) {
        throw new Error("salon unavailable");
      }
      const parsed = parseWaiterSalonView(await response.json());
      const parsedOrders = parseWaiterOrdersView(await ordersResponse.json());
      if (!parsed || !parsedOrders) throw new Error("salon invalid");
      setView(parsed);
      setOrders(parsedOrders);
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

  const itemLabel = (orderId: string, lineId: string) => {
    const item = orders.orders
      .find((entry) => entry.orderId === orderId)
      ?.items.find((entry) => entry.lineId === lineId);
    return item ? `${item.quantity} × ${item.title}` : "El ítem";
  };
  const report = (result: WaiterActionResult<unknown>, success: string) =>
    setNotice(
      result.status === "ok"
        ? { kind: "ok", text: success }
        : { kind: "error", text: result.message }
    );

  async function deliver(orderId: string, lineId: string) {
    const label = itemLabel(orderId, lineId);
    const result = await perform(`deliver:${lineId}`, (commandId) =>
      deliverItemAction(tenantSlug, orderId, lineId, { commandId })
    );
    report(result, `Entregaste ${label}.`);
  }

  async function propose(
    orderId: string,
    lineId: string,
    productId: string,
    variantId: string | null
  ) {
    const result = await perform(
      `propose:${lineId}:${productId}:${variantId ?? ""}`,
      (commandId) =>
        proposeReplacementAction(tenantSlug, orderId, lineId, {
          commandId,
          productId,
          variantId
        })
    );
    report(
      result,
      result.status === "ok"
        ? `Propuesta: ${result.data.replacementTitle} (${differenceLabel(
            result.data.differenceCents
          )}). Preguntale al comensal.`
        : ""
    );
  }

  async function decideReplacement(
    adjustmentId: string,
    decision: "accept" | "reject",
    reason: string | null
  ) {
    const result = await perform(
      `decide:${adjustmentId}:${decision}:${reason ?? ""}`,
      (commandId) =>
        decideReplacementAction(
          tenantSlug,
          adjustmentId,
          decision === "accept"
            ? { commandId, decision, reason: null }
            : { commandId, decision, reason: reason ?? "" }
        )
    );
    report(
      result,
      decision === "accept"
        ? "Reemplazo aceptado: va a producción."
        : "Reemplazo rechazado. El faltante sigue abierto."
    );
  }

  async function cancelItem(orderId: string, lineId: string, reason: string) {
    const label = itemLabel(orderId, lineId);
    const result = await perform(`cancel:${lineId}:${reason}`, (commandId) =>
      cancelItemAction(tenantSlug, orderId, lineId, { commandId, reason })
    );
    report(result, `Cancelaste ${label}.`);
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
  const attention = orders.orders.reduce(
    (sum, order) => sum + attentionCount(order.items),
    0
  );

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
        <button
          aria-pressed={tab === "pedidos"}
          onClick={() => setTab("pedidos")}
          type="button"
        >
          Pedidos en curso
          {attention > 0 ? (
            <span
              aria-label={`${attention} requieren atención`}
              className="waiter-count"
            >
              {attention}
            </span>
          ) : null}
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
          onOpenOrders={() => {
            setConfirmed(null);
            setTab("pedidos");
          }}
          order={confirmed.order}
          tableLabel={confirmed.tableLabel}
        />
      ) : null}

      {tab === "pedidos" ? (
        <OrdersInProgress
          busy={busy}
          isManager={isManager}
          menu={menu}
          now={now}
          onCancel={(orderId, lineId, reason) =>
            void cancelItem(orderId, lineId, reason)
          }
          onDecide={(adjustmentId, decision, reason) =>
            void decideReplacement(adjustmentId, decision, reason)
          }
          onDeliver={(orderId, lineId) => void deliver(orderId, lineId)}
          onPropose={(orderId, lineId, productId, variantId) =>
            void propose(orderId, lineId, productId, variantId)
          }
          orders={orders.orders}
        />
      ) : tab === "salon" ? (
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
