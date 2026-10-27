"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useLiveSync } from "../../../lib/use-live-sync";

/** Time between checks while the diner keeps the page visible and Realtime is not there. */
export const entryRefreshIntervalMs = 15_000;

/**
 * Asks the server again what the QR means so a table that was grouped, separated
 * or taken out of service while the page stays open does not show stale advice.
 * Realtime says when something about the table changed; without it the page asks every
 * few seconds, as it always did. Nothing is kept on the device: the answer is always
 * recalculated server-side.
 */
export function EntryRefresh({ token }: { token: string }) {
  const router = useRouter();
  const refresh = useCallback(async () => {
    router.refresh();
    return true;
  }, [router]);
  useLiveSync({
    endpoint: "/api/diner-realtime",
    grantBody: { token },
    // The menu's availability is not announced: keep asking at the old pace even when live.
    heartbeatMs: entryRefreshIntervalMs,
    pollMs: entryRefreshIntervalMs,
    refresh
  });
  return null;
}
