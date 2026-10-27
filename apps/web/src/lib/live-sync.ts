/**
 * Keeps a screen faithful to the server without ever treating a notification as data.
 *
 * Realtime only says "something changed"; the screen then asks the API for the state, and
 * does the same after every reconnection, so a missed message costs nothing. When Realtime
 * is not available (no secret configured, an expired token, a dropped socket) it falls back
 * to polling, and while the device is offline it says so instead of pretending.
 */
export type LiveStatus = "live" | "offline" | "polling" | "reconnecting";

export type RealtimeGrant = {
  channels: string[];
  expiresAt: string;
  publishableKey: string;
  token: string;
  url: string;
};

export type RealtimeHandle = {
  close(): void;
  /** Hands over a fresh token; the connection stays. */
  renew(token: string): void;
};

export type RealtimeHandlers = {
  /** A channel said something changed. */
  onChange(): void;
  /** True while every channel is subscribed. */
  onLive(live: boolean): void;
};

export type LiveSyncDeps = {
  /** Fetches the authoritative state; true when it succeeded. */
  refresh(): Promise<boolean>;
  /** Gets a short-lived token for Realtime; null when it is not available here. */
  fetchGrant(): Promise<RealtimeGrant | null>;
  connect(grant: RealtimeGrant, handlers: RealtimeHandlers): RealtimeHandle;
  isOnline(): boolean;
  isVisible(): boolean;
  /** Forgets what the service worker cached: after a reconnection nothing old is trusted. */
  invalidateCaches(): void;
  onStatus(status: LiveStatus): void;
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  /** How often to ask without Realtime (default 5 s). */
  pollMs?: number;
  /** How often to ask even with Realtime, as a safety net (default 60 s). */
  heartbeatMs?: number;
  /** Merges a burst of messages into one request (default 150 ms). */
  debounceMs?: number;
};

export type LiveSync = {
  /** A message arrived or the screen wants the state right now. */
  changed(): void;
  online(): void;
  offline(): void;
  start(): void;
  stop(): void;
  visible(): void;
};

export function createLiveSync(deps: LiveSyncDeps): LiveSync {
  const pollMs = deps.pollMs ?? 5_000;
  const heartbeatMs = deps.heartbeatMs ?? 60_000;
  const debounceMs = deps.debounceMs ?? 150;
  const grantRetryMs = 5 * 60_000;

  let running = false;
  let live = false;
  let refreshOk = true;
  let inFlight = false;
  let again = false;
  let handle: RealtimeHandle | null = null;
  let grant: RealtimeGrant | null = null;
  let tick: unknown = null;
  let debounce: unknown = null;
  let renewal: unknown = null;
  let regrant: unknown = null;
  let last: LiveStatus | null = null;

  function status(): LiveStatus {
    if (!deps.isOnline()) return "offline";
    if (!refreshOk) return "reconnecting";
    return live ? "live" : "polling";
  }

  function publish() {
    if (!running) return;
    const next = status();
    if (next !== last) {
      last = next;
      deps.onStatus(next);
    }
  }

  function cancel(timer: unknown) {
    if (timer !== null) deps.clearTimeout(timer);
  }

  async function run(): Promise<boolean> {
    if (inFlight) {
      // One request at a time; whatever arrived meanwhile is covered by one more.
      again = true;
      return true;
    }
    inFlight = true;
    const ok = await (
      deps.isOnline() ? deps.refresh() : Promise.resolve(false)
    ).catch(() => false);
    inFlight = false;
    refreshOk = ok || !deps.isOnline();
    publish();
    if (again && running) {
      again = false;
      void run();
    }
    return ok;
  }

  function schedule() {
    cancel(tick);
    tick = null;
    if (!running) return;
    const wait = live && refreshOk ? heartbeatMs : pollMs;
    tick = deps.setTimeout(() => {
      tick = null;
      if (deps.isVisible() && deps.isOnline()) void run();
      schedule();
    }, wait);
  }

  function setLive(value: boolean) {
    if (live === value) return;
    live = value;
    publish();
    schedule();
    // Coming (back) online with Realtime is the moment to be sure of the state.
    if (value) void run();
  }

  function closeRealtime() {
    cancel(renewal);
    renewal = null;
    handle?.close();
    handle = null;
    grant = null;
    setLive(false);
  }

  function planRenewal(current: RealtimeGrant) {
    cancel(renewal);
    const lifetime = Date.parse(current.expiresAt) - deps.now();
    renewal = deps.setTimeout(
      () => void renew(),
      Math.max(5_000, Math.floor(lifetime * 0.8))
    );
  }

  async function renew() {
    renewal = null;
    if (!running || !handle) return;
    const next = await deps.fetchGrant().catch(() => null);
    if (!running || !handle) return;
    if (next) {
      grant = next;
      handle.renew(next.token);
      planRenewal(next);
      return;
    }
    // Could not renew: keep what we have until it expires, trying again soon.
    if (grant && Date.parse(grant.expiresAt) <= deps.now()) {
      closeRealtime();
      scheduleRegrant(15_000);
      return;
    }
    renewal = deps.setTimeout(() => void renew(), 15_000);
  }

  function scheduleRegrant(ms: number) {
    cancel(regrant);
    if (!running) return;
    regrant = deps.setTimeout(() => {
      regrant = null;
      void open();
    }, ms);
  }

  async function open() {
    if (!running || handle || !deps.isOnline()) return;
    const next = await deps.fetchGrant().catch(() => null);
    if (!running || handle) return;
    if (!next || next.channels.length === 0) {
      scheduleRegrant(grantRetryMs);
      return;
    }
    grant = next;
    handle = deps.connect(next, {
      onChange: () => api.changed(),
      onLive: (value) => setLive(value)
    });
    planRenewal(next);
  }

  const api: LiveSync = {
    changed() {
      if (!running) return;
      cancel(debounce);
      debounce = deps.setTimeout(() => {
        debounce = null;
        void run();
      }, debounceMs);
    },
    offline() {
      if (!running) return;
      closeRealtime();
      publish();
    },
    online() {
      if (!running) return;
      // Whatever the device remembered about the server is not to be trusted now.
      deps.invalidateCaches();
      publish();
      void run();
      void open();
      schedule();
    },
    start() {
      if (running) return;
      running = true;
      publish();
      schedule();
      void open();
    },
    stop() {
      running = false;
      cancel(tick);
      cancel(debounce);
      cancel(regrant);
      tick = debounce = regrant = null;
      closeRealtime();
    },
    visible() {
      if (!running || !deps.isVisible()) return;
      void run();
      schedule();
    }
  };
  return api;
}
