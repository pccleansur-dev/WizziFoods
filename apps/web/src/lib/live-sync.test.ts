import { describe, expect, it, vi } from "vitest";

import {
  createLiveSync,
  type LiveStatus,
  type RealtimeGrant,
  type RealtimeHandlers
} from "./live-sync";

/** A clock and a Realtime connection that the test drives by hand. */
function harness(
  options: {
    grant?: RealtimeGrant | null | (() => Promise<RealtimeGrant | null>);
    refresh?: () => Promise<boolean>;
  } = {}
) {
  let now = Date.parse("2026-10-31T12:00:00Z");
  let online = true;
  let visible = true;
  let counter = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const statuses: LiveStatus[] = [];
  const handlers: RealtimeHandlers[] = [];
  const closed: number[] = [];
  const renewed: string[] = [];
  const refresh = vi.fn(options.refresh ?? (() => Promise.resolve(true)));
  const invalidate = vi.fn();
  const grantFor = (minutes: number): RealtimeGrant => ({
    channels: ["tenant:t:location:l:salon"],
    expiresAt: new Date(now + minutes * 60_000).toISOString(),
    publishableKey: "key",
    token: `token-${++counter}`,
    url: "http://localhost"
  });
  const fetchGrant = vi.fn(() => {
    const value = options.grant === undefined ? grantFor(10) : options.grant;
    return typeof value === "function"
      ? value()
      : Promise.resolve(value === null ? null : value);
  });
  const sync = createLiveSync({
    clearTimeout: (handle) => timers.delete(handle as number),
    connect: (_grant, h) => {
      handlers.push(h);
      const index = handlers.length;
      return {
        close: () => closed.push(index),
        renew: (token) => renewed.push(token)
      };
    },
    fetchGrant,
    invalidateCaches: invalidate,
    isOnline: () => online,
    isVisible: () => visible,
    now: () => now,
    onStatus: (status) => statuses.push(status),
    refresh,
    setTimeout: (run, ms) => {
      const id = ++counter;
      timers.set(id, { at: now + ms, run });
      return id;
    }
  });
  async function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
      await flush();
    }
    now = target;
    await flush();
  }
  async function flush() {
    for (let n = 0; n < 8; n += 1) await Promise.resolve();
  }
  return {
    advance,
    closed,
    flush,
    fetchGrant,
    handlers,
    invalidate,
    refresh,
    renewed,
    setOnline: (value: boolean) => {
      online = value;
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    statuses,
    sync
  };
}

describe("live sync", () => {
  it("asks for the state as soon as Realtime is subscribed, then trusts it for a minute", async () => {
    const h = harness();
    h.sync.start();
    await h.flush();
    expect(h.handlers).toHaveLength(1);
    expect(h.refresh).not.toHaveBeenCalled();
    h.handlers[0]!.onLive(true);
    await h.flush();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.statuses.at(-1)).toBe("live");
    await h.advance(30_000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await h.advance(31_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("merges a burst of messages into one request, and one more if it arrived meanwhile", async () => {
    let release: (() => void) | null = null;
    const h = harness({
      refresh: () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        })
    });
    h.sync.start();
    await h.flush();
    for (let n = 0; n < 5; n += 1) h.sync.changed();
    await h.advance(200);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.sync.changed();
    await h.advance(200);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    release!();
    await h.flush();
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("polls every five seconds when Realtime is not there, and not while hidden", async () => {
    const h = harness({ grant: null });
    h.sync.start();
    await h.flush();
    expect(h.statuses.at(-1)).toBe("polling");
    await h.advance(5_000);
    await h.advance(5_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.setVisible(false);
    await h.advance(30_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.setVisible(true);
    h.sync.visible();
    await h.flush();
    expect(h.refresh).toHaveBeenCalledTimes(3);
  });

  it("says it is offline, stops asking, and on every return forgets the cache and asks the server", async () => {
    const h = harness();
    h.sync.start();
    await h.flush();
    h.handlers[0]!.onLive(true);
    await h.flush();
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      const before = h.refresh.mock.calls.length;
      h.setOnline(false);
      h.sync.offline();
      await h.advance(20_000);
      expect(h.statuses.at(-1)).toBe("offline");
      expect(h.refresh.mock.calls.length).toBe(before);
      expect(h.closed).toHaveLength(cycle);

      h.setOnline(true);
      h.sync.online();
      await h.flush();
      expect(h.invalidate).toHaveBeenCalledTimes(cycle);
      expect(h.refresh.mock.calls.length).toBe(before + 1);
      expect(h.handlers).toHaveLength(cycle + 1);
      h.handlers[cycle]!.onLive(true);
      await h.flush();
      expect(h.statuses.at(-1)).toBe("live");
    }
  });

  it("is reconnecting while the server does not answer, and recovers by itself", async () => {
    let healthy = false;
    const h = harness({
      grant: null,
      refresh: () => Promise.resolve(healthy)
    });
    h.sync.start();
    await h.flush();
    await h.advance(5_000);
    expect(h.statuses.at(-1)).toBe("reconnecting");
    healthy = true;
    await h.advance(5_000);
    expect(h.statuses.at(-1)).toBe("polling");
  });

  it("renews the token before it expires and keeps the connection", async () => {
    const h = harness();
    h.sync.start();
    await h.flush();
    h.handlers[0]!.onLive(true);
    await h.flush();
    expect(h.fetchGrant).toHaveBeenCalledTimes(1);
    await h.advance(8 * 60_000 + 1_000);
    expect(h.fetchGrant).toHaveBeenCalledTimes(2);
    expect(h.renewed).toHaveLength(1);
    expect(h.closed).toHaveLength(0);
  });

  it("falls back to polling if the token can no longer be renewed", async () => {
    let calls = 0;
    const h = harness({
      grant: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? {
                channels: ["tenant:t:location:l:salon"],
                expiresAt: new Date(
                  Date.parse("2026-10-31T12:00:00Z") + 600_000
                ).toISOString(),
                publishableKey: "key",
                token: "first",
                url: "http://localhost"
              }
            : null
        );
      }
    });
    h.sync.start();
    await h.flush();
    h.handlers[0]!.onLive(true);
    await h.flush();
    await h.advance(11 * 60_000);
    expect(h.closed).toHaveLength(1);
    expect(h.statuses.at(-1)).not.toBe("live");
    const before = h.refresh.mock.calls.length;
    await h.advance(10_000);
    expect(h.refresh.mock.calls.length).toBeGreaterThan(before);
  });

  it("does nothing after it is stopped", async () => {
    const h = harness({ grant: null });
    h.sync.start();
    await h.flush();
    h.sync.stop();
    const before = h.refresh.mock.calls.length;
    h.sync.changed();
    await h.advance(60_000);
    expect(h.refresh.mock.calls.length).toBe(before);
  });
});
