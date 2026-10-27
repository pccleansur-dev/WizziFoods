"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "./pwa";

/**
 * Registers the service worker once the page has finished loading and the browser is
 * idle. It renders nothing and a failure is silent: no page waits for it or depends on it.
 */
export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      void registerServiceWorker().catch(() => undefined);
    };
    const idle = (
      window as Window & { requestIdleCallback?: (cb: () => void) => number }
    ).requestIdleCallback;
    const start = () =>
      idle ? idle(register) : window.setTimeout(register, 1_000);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => window.removeEventListener("load", start);
  }, []);
  return null;
}
