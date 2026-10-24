"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Time between checks while the diner keeps the page visible. */
export const entryRefreshIntervalMs = 15_000;

/**
 * Asks the server again what the QR means so a table that was grouped, separated
 * or taken out of service while the page stays open does not show stale advice.
 * Nothing is kept on the device: the answer is always recalculated server-side.
 */
export function EntryRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, entryRefreshIntervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return null;
}
