"use client";

import type {
  CatalogProduct,
  DinerDraftItem,
  DinerDraftQuote
} from "@platform/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  addDraftItem,
  draftStorageKey,
  parseDinerDraftQuoteResponse,
  parseStoredDraft,
  setDraftQuantity
} from "./diner-draft";
import { DinerMenu } from "./diner-menu";
import { DinerOrder } from "./diner-order";
import {
  DinerCheckout,
  DinerIntentAccepted,
  type DinerCheckoutValue
} from "./diner-checkout";
import {
  parseOrderIntentResponse,
  type OrderIntentPaymentMethod
} from "./order-intent";
import type { PublicCatalog } from "./public-catalog";

export function DinerExperience({
  catalog,
  paymentMethods,
  token
}: {
  catalog: PublicCatalog | null;
  paymentMethods: OrderIntentPaymentMethod[];
  token: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<DinerDraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<DinerDraftQuote | null>(null);
  const [accepted, setAccepted] = useState<
    "awaiting_waiter" | "payment_pending" | null
  >(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<"menu" | "order" | "checkout">("menu");
  const lastSubmission = useRef<{
    commandId: string;
    payload: string;
  } | null>(null);
  const storageKey = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : draftStorageKey(window.location.host, token),
    [token]
  );
  const availabilitySignature = JSON.stringify(catalog?.availability ?? {});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setItems(parseStoredDraft(window.localStorage.getItem(storageKey)));
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, JSON.stringify(items));
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      if (items.length === 0) {
        setQuote({
          canConfirm: false,
          catalogRevision: catalog?.revision ?? null,
          items: [],
          totalCents: 0
        });
        setLoading(false);
        return;
      }
      void fetch("/api/diner-draft", {
        body: JSON.stringify({ items, token }),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
        .then(async (response) =>
          response.ok
            ? parseDinerDraftQuoteResponse(await response.json())
            : null
        )
        .then((nextQuote) => {
          if (!nextQuote) throw new Error("invalid quote");
          if (active) setQuote(nextQuote);
        })
        .catch((caught: unknown) => {
          if (active && (caught as Error).name !== "AbortError") {
            setQuote(null);
            setError("No pudimos actualizar tu pedido. Intentá nuevamente.");
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    availabilitySignature,
    catalog?.revision,
    hydrated,
    items,
    storageKey,
    token
  ]);

  if (!catalog) {
    return (
      <section className="diner-empty" role="alert">
        <h2>Carta no disponible</h2>
        <p>Pedile la carta al personal del local.</p>
      </section>
    );
  }

  const add = (
    product: CatalogProduct,
    variantId: string | null,
    quantity: number
  ) => {
    setItems((current) =>
      addDraftItem(current, {
        lineId: crypto.randomUUID(),
        productId: product.id,
        quantity,
        variantId
      })
    );
    setView("order");
  };
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const submitIntent = (value: DinerCheckoutValue) => {
    if (!quote?.canConfirm || submitting) return;
    const stablePayload = JSON.stringify({
      attribution: value.attribution,
      dinerName: value.dinerName,
      items,
      paymentMethod: value.paymentMethod.method,
      paymentPath: value.paymentMethod.paymentPath,
      seatLabel: value.seatLabel,
      token
    });
    const commandId =
      lastSubmission.current?.payload === stablePayload
        ? lastSubmission.current.commandId
        : crypto.randomUUID();
    lastSubmission.current = { commandId, payload: stablePayload };
    setSubmitting(true);
    setCheckoutError(null);
    void fetch("/api/order-intents", {
      body: JSON.stringify({ commandId, ...JSON.parse(stablePayload) }),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
      .then(async (response) =>
        response.ok ? parseOrderIntentResponse(await response.json()) : null
      )
      .then((result) => {
        if (!result) throw new Error("intent rejected");
        window.localStorage.removeItem(storageKey);
        setItems([]);
        setAccepted(result.status);
      })
      .catch(() => {
        setCheckoutError(
          "No pudimos enviar el pedido. Tu selección sigue guardada; intentá nuevamente."
        );
      })
      .finally(() => setSubmitting(false));
  };

  if (accepted) return <DinerIntentAccepted status={accepted} />;
  return (
    <div className="diner-experience">
      <nav aria-label="Carta y pedido" className="diner-nav">
        <button
          aria-current={view === "menu" ? "page" : undefined}
          onClick={() => setView("menu")}
          type="button"
        >
          Carta
        </button>
        <button
          aria-current={view !== "menu" ? "page" : undefined}
          onClick={() => setView("order")}
          type="button"
        >
          Mi pedido{" "}
          <span aria-label={`${itemCount} unidades`}>{itemCount}</span>
        </button>
      </nav>
      {view === "menu" ? (
        <DinerMenu catalog={catalog} onAdd={add} />
      ) : view === "order" ? (
        <DinerOrder
          error={error}
          items={items}
          loading={loading}
          onContinue={() => setView("checkout")}
          onQuantity={(lineId, quantity) =>
            setItems((current) => setDraftQuantity(current, lineId, quantity))
          }
          quote={quote}
        />
      ) : (
        <DinerCheckout
          error={checkoutError}
          methods={paymentMethods}
          onBack={() => setView("order")}
          onSubmit={submitIntent}
          submitting={submitting}
        />
      )}
    </div>
  );
}
