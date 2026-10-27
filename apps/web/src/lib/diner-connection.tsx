"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** Whether the browser believes it can reach the network (always true on the server). */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  );
}

/**
 * For the diner's menu: says so when the device is offline (what is shown may be old and
 * no order can be sent) and, when the connection returns, forgets what the device
 * remembered and asks the server for the current menu and availability.
 */
export function DinerConnection() {
  const online = useOnlineStatus();
  const router = useRouter();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: "invalidate" });
    } catch {
      // No service worker: nothing cached, nothing to forget.
    }
    router.refresh();
  }, [online, router]);

  if (online) return null;
  return (
    <p
      className="waiter-notice waiter-notice--error connection-banner connection-banner--offline"
      data-live-status="offline"
      role="status"
    >
      Sin conexión. Lo que ves puede estar desactualizado y no podés enviar el
      pedido hasta que vuelva la conexión.
    </p>
  );
}
