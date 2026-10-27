"use client";

import { parseBrowserRealtimeGrant } from "@platform/contracts";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

import {
  createLiveSync,
  type LiveStatus,
  type RealtimeGrant
} from "./live-sync";

export type LiveState = {
  /** When the screen last had the authoritative state, as a timestamp; null if never. */
  lastSyncAt: number | null;
  status: LiveStatus;
};

/** Asks the service worker to forget everything it cached. */
function invalidateCaches(): void {
  try {
    void navigator.serviceWorker?.controller?.postMessage({
      type: "invalidate"
    });
  } catch {
    // No service worker: nothing cached, nothing to forget.
  }
}

function connectBrowser(
  grant: RealtimeGrant,
  handlers: { onChange(): void; onLive(live: boolean): void }
) {
  const client = createClient(grant.url, grant.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  client.realtime.setAuth(grant.token);
  const state = new Map<string, boolean>();
  const report = () =>
    handlers.onLive(
      grant.channels.length > 0 &&
        grant.channels.every((channel) => state.get(channel) === true)
    );
  for (const name of grant.channels) {
    state.set(name, false);
    client
      .channel(name, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => handlers.onChange())
      .subscribe((status) => {
        state.set(name, status === "SUBSCRIBED");
        report();
      });
  }
  return {
    close: () => {
      void client.removeAllChannels();
      client.realtime.disconnect();
    },
    renew: (token: string) => client.realtime.setAuth(token)
  };
}

/**
 * Keeps a staff screen faithful to the server: live through Realtime when it is
 * available, polling when it is not, honest when the device is offline. `refresh` fetches
 * the authoritative state and returns whether it worked.
 */
export function useLiveSync(options: {
  endpoint: string;
  pollMs?: number;
  refresh: () => Promise<boolean>;
}): LiveState {
  const [state, setState] = useState<LiveState>({
    lastSyncAt: null,
    status: "polling"
  });
  const refreshRef = useRef(options.refresh);
  useEffect(() => {
    refreshRef.current = options.refresh;
  });
  const { endpoint, pollMs } = options;

  useEffect(() => {
    const sync = createLiveSync({
      ...(pollMs === undefined ? {} : { pollMs }),
      clearTimeout: (handle) => clearTimeout(handle as number),
      connect: connectBrowser,
      fetchGrant: async () => {
        try {
          const response = await fetch(endpoint, {
            cache: "no-store",
            method: "POST"
          });
          if (!response.ok) return null;
          return parseBrowserRealtimeGrant(await response.json());
        } catch {
          return null;
        }
      },
      invalidateCaches,
      isOnline: () => navigator.onLine,
      isVisible: () => document.visibilityState === "visible",
      now: () => Date.now(),
      onStatus: (status) => setState((current) => ({ ...current, status })),
      refresh: async () => {
        const ok = await refreshRef.current();
        if (ok) setState((current) => ({ ...current, lastSyncAt: Date.now() }));
        return ok;
      },
      setTimeout: (callback, ms) => setTimeout(callback, ms)
    });
    const onOnline = () => sync.online();
    const onOffline = () => sync.offline();
    const onVisible = () => sync.visible();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    sync.start();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      sync.stop();
    };
  }, [endpoint, pollMs]);

  return state;
}
