"use client";

import type {
  CatalogProduct,
  DinerDraftItem,
  DinerDraftQuote
} from "@platform/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  addDraftItem,
  draftStorageKey,
  parseDinerDraftQuoteResponse,
  parseStoredDraft,
  setDraftQuantity
} from "./diner-draft";
import { DinerMenu } from "./diner-menu";
import { DinerOrder } from "./diner-order";
import type { PublicCatalog } from "./public-catalog";

export function DinerExperience({
  catalog,
  token
}: {
  catalog: PublicCatalog | null;
  token: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<DinerDraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<DinerDraftQuote | null>(null);
  const [view, setView] = useState<"menu" | "order">("menu");
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
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetch("/api/diner-draft", {
        body: JSON.stringify({ items, token }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal
      })
        .then(async (response) =>
          response.ok
            ? parseDinerDraftQuoteResponse(await response.json())
            : null
        )
        .then((nextQuote) => {
          if (!nextQuote) throw new Error("invalid quote");
          setQuote(nextQuote);
        })
        .catch((caught: unknown) => {
          if ((caught as Error).name !== "AbortError") {
            setQuote(null);
            setError("No pudimos actualizar tu pedido. Intentá nuevamente.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [availabilitySignature, hydrated, items, storageKey, token]);

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
          aria-current={view === "order" ? "page" : undefined}
          onClick={() => setView("order")}
          type="button"
        >
          Mi pedido{" "}
          <span aria-label={`${itemCount} unidades`}>{itemCount}</span>
        </button>
      </nav>
      {view === "menu" ? (
        <DinerMenu catalog={catalog} onAdd={add} />
      ) : (
        <DinerOrder
          error={error}
          items={items}
          loading={loading}
          onQuantity={(lineId, quantity) =>
            setItems((current) => setDraftQuantity(current, lineId, quantity))
          }
          quote={quote}
        />
      )}
    </div>
  );
}
