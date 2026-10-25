"use client";

import {
  parseCashRegisterView,
  parseWaiterAccountsView,
  parseWaiterOrdersView,
  parseWaiterSalonView,
  type CashMovementKind,
  type CashRegisterView,
  type CloseShiftResult,
  type WaiterAccountsView,
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
  applyDiscountAction,
  keepAccountOpenAction,
  recordPaymentAction
} from "../account-actions";
import {
  closeShiftAction,
  openShiftAction,
  recordCashMovementAction,
  recordRefundAction
} from "../cash-register-actions";
import {
  cancelItemAction,
  decideReplacementAction,
  deliverItemAction,
  proposeReplacementAction
} from "../order-adjustment-actions";
import type { WaiterActionResult } from "../waiter-action-result";
import { ConfirmedOrderPanel } from "./confirmed-order-panel";
import { ManualOrderForm, type ManualOrderDraft } from "./manual-order-form";
import {
  AccountsPanel,
  type DiscountDraft,
  type PaymentDraft,
  type RefundDraft
} from "./accounts-panel";
import { CashPanel } from "./cash-panel";
import { OrdersInProgress } from "./orders-in-progress";
import { WaiterPending } from "./waiter-pending";
import { WaiterTables } from "./waiter-tables";
import { newId } from "../../../../../lib/new-id";
import {
  accountBalanceLabel,
  accountForTable
} from "../../../../../staff/account-view";
import {
  attentionCount,
  differenceLabel
} from "../../../../../staff/orders-in-progress-view";

const POLL_MS = 5_000;

type Notice = { kind: "error" | "ok"; text: string };
type Tab = "caja" | "comanda" | "cuentas" | "pedidos" | "salon";

export function WaiterWorkspace({
  canCreateOrders,
  canValidate,
  initialAccounts,
  initialCash,
  initialOrders,
  initialTab,
  initialView,
  isManager,
  menu,
  tenantSlug
}: {
  canCreateOrders: boolean;
  canValidate: boolean;
  initialAccounts: WaiterAccountsView;
  /** Only a manager operates the register, so only a manager loads it. */
  initialCash: CashRegisterView | null;
  initialOrders: WaiterOrdersView;
  initialTab: Tab;
  initialView: WaiterSalonView;
  isManager: boolean;
  menu: WaiterMenuProduct[];
  tenantSlug: string;
}) {
  const [view, setView] = useState(initialView);
  const [orders, setOrders] = useState(initialOrders);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [cash, setCash] = useState(initialCash);
  // Account whose collection form opens when the accounts tab is shown.
  const [collectSession, setCollectSession] = useState<string | null>(null);
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
      const [response, ordersResponse, accountsResponse, cashResponse] =
        await Promise.all([
        fetch(`/interno/${tenantSlug}/operacion/vista`, { cache: "no-store" }),
        fetch(`/interno/${tenantSlug}/operacion/pedidos/vista`, {
          cache: "no-store"
        }),
        fetch(`/interno/${tenantSlug}/operacion/cuentas/vista`, {
          cache: "no-store"
        }),
        isManager
          ? fetch(`/interno/${tenantSlug}/operacion/caja/vista`, {
              cache: "no-store"
            })
          : Promise.resolve(null)
      ]);
      if (
        response.status === 401 ||
        ordersResponse.status === 401 ||
        accountsResponse.status === 401 ||
        cashResponse?.status === 401
      ) {
        setExpired(true);
        return;
      }
      if (
        !response.ok ||
        !ordersResponse.ok ||
        !accountsResponse.ok ||
        (cashResponse !== null && !cashResponse.ok)
      ) {
        throw new Error("salon unavailable");
      }
      const parsed = parseWaiterSalonView(await response.json());
      const parsedOrders = parseWaiterOrdersView(await ordersResponse.json());
      const parsedAccounts = parseWaiterAccountsView(
        await accountsResponse.json()
      );
      const parsedCash = cashResponse
        ? parseCashRegisterView(await cashResponse.json())
        : null;
      if (!parsed || !parsedOrders || !parsedAccounts) {
        throw new Error("salon invalid");
      }
      if (cashResponse && !parsedCash) throw new Error("cash invalid");
      if (parsedCash) setCash(parsedCash);
      setView(parsed);
      setOrders(parsedOrders);
      setAccounts(parsedAccounts);
      setStale(false);
      setNow(Date.now());
    } catch {
      setStale(true);
    }
  }, [isManager, tenantSlug]);

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

  const tableOf = (tableLabel: string) =>
    accountForTable(accounts.accounts, tableLabel.replace(/^Mesa\s+/u, ""));

  async function pay(sessionId: string, draft: PaymentDraft) {
    const result = await perform(
      `pay:${sessionId}:${draft.method}:${draft.amountCents ?? "all"}:${draft.tipCents}`,
      (commandId) =>
        recordPaymentAction(tenantSlug, sessionId, { ...draft, commandId })
    );
    report(
      result,
      result.status === "ok"
        ? `Cobro registrado. ${
            result.data.pendingCents === 0
              ? "La cuenta quedó saldada."
              : "Queda saldo pendiente."
          }`
        : ""
    );
  }

  async function discount(sessionId: string, draft: DiscountDraft) {
    const result = await perform(
      `discount:${sessionId}:${draft.kind}:${draft.value}:${draft.reason}`,
      (commandId) =>
        applyDiscountAction(tenantSlug, sessionId, { ...draft, commandId })
    );
    report(result, "Descuento aplicado a la cuenta.");
  }

  async function keepOpen(sessionId: string) {
    const result = await perform(`keep:${sessionId}`, (commandId) =>
      keepAccountOpenAction(tenantSlug, sessionId, { commandId })
    );
    report(result, "La cuenta quedó abierta: cobrás después desde Cuentas.");
  }

  async function refund(sessionId: string, draft: RefundDraft) {
    const result = await perform(
      `refund:${sessionId}:${draft.paymentId}:${draft.amountCents}:${draft.reason}`,
      (commandId) =>
        recordRefundAction(tenantSlug, sessionId, {
          ...draft,
          commandId,
          itemLineId: null
        })
    );
    report(result, "Devolución registrada en la caja.");
  }

  async function openRegister(openingCashCents: number) {
    const result = await perform(`open:${openingCashCents}`, (commandId) =>
      openShiftAction(tenantSlug, { commandId, openingCashCents })
    );
    report(result, "Caja abierta: ya se puede cobrar.");
  }

  async function moveCash(
    kind: CashMovementKind,
    amountCents: number,
    reason: string
  ) {
    const result = await perform(
      `movement:${kind}:${amountCents}:${reason}`,
      (commandId) =>
        recordCashMovementAction(tenantSlug, {
          amountCents,
          commandId,
          kind,
          reason
        })
    );
    report(result, "Movimiento de efectivo registrado.");
  }

  async function closeRegister(
    countedCashCents: number,
    reason: string | null
  ): Promise<CloseShiftResult | null> {
    const result = await perform(
      `close:${countedCashCents}:${reason ?? ""}`,
      (commandId) =>
        closeShiftAction(tenantSlug, { commandId, countedCashCents, reason })
    );
    if (result.status === "error") {
      setNotice({ kind: "error", text: result.message });
      return null;
    }
    if (result.data.closed) {
      setNotice({ kind: "ok", text: "Caja cerrada." });
    }
    return result.data;
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
  const owing = accounts.accounts.filter(
    (account) => account.summary.pendingCents > 0
  ).length;
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
          aria-pressed={tab === "cuentas"}
          onClick={() => setTab("cuentas")}
          type="button"
        >
          Cuentas
          {owing > 0 ? (
            <span
              aria-label={`${owing} con saldo pendiente`}
              className="waiter-count"
            >
              {owing}
            </span>
          ) : null}
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
        {isManager ? (
          <button
            aria-pressed={tab === "caja"}
            onClick={() => setTab("caja")}
            type="button"
          >
            Caja
            {!accounts.cashRegisterOpen ? (
              <span aria-label="caja cerrada" className="waiter-count">
                !
              </span>
            ) : null}
          </button>
        ) : null}
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
          accountLabel={(() => {
            const account = tableOf(confirmed.tableLabel);
            return account ? accountBalanceLabel(account.summary) : null;
          })()}
          busy={busy !== null}
          onCollectNow={() => {
            setCollectSession(tableOf(confirmed.tableLabel)?.sessionId ?? null);
            setConfirmed(null);
            setTab("cuentas");
          }}
          onDismiss={() => setConfirmed(null)}
          onKeepOpen={() => {
            const account = tableOf(confirmed.tableLabel);
            if (!account) return;
            setConfirmed(null);
            void keepOpen(account.sessionId);
          }}
          onOpenOrders={() => {
            setConfirmed(null);
            setTab("pedidos");
          }}
          order={confirmed.order}
          tableLabel={confirmed.tableLabel}
        />
      ) : null}

      {tab === "cuentas" ? (
        <AccountsPanel
          accounts={accounts.accounts}
          busy={busy}
          cashOpen={accounts.cashRegisterOpen}
          collectSessionId={collectSession}
          isManager={isManager}
          onDiscount={(sessionId, draft) => void discount(sessionId, draft)}
          onKeepOpen={(sessionId) => void keepOpen(sessionId)}
          onPay={(sessionId, draft) => void pay(sessionId, draft)}
          onRefund={(sessionId, draft) => void refund(sessionId, draft)}
        />
      ) : tab === "caja" && cash ? (
        <CashPanel
          busy={busy}
          onClose={closeRegister}
          onMovement={(kind, amount, reason) =>
            void moveCash(kind, amount, reason)
          }
          onOpen={(opening) => void openRegister(opening)}
          owingAccounts={owing}
          view={cash}
        />
      ) : tab === "pedidos" ? (
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
