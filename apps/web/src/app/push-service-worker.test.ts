import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;

/** Runs public/sw.js against a stand-in for the worker's global scope. */
function load() {
  const listeners = new Map<string, Listener>();
  const shown: Array<{ options: Record<string, unknown>; title: string }> = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const windows: Array<{
    focus: () => Promise<void>;
    navigate: (url: string) => Promise<void>;
    url: string;
  }> = [];
  const scope = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    clients: {
      claim: vi.fn(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve();
      }
    },
    location: { origin: "https://local.example.test" },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ options, title });
        return Promise.resolve();
      }
    },
    skipWaiting: vi.fn()
  };
  const code = readFileSync(
    path.resolve(__dirname, "../../public/sw.js"),
    "utf8"
  );
  new Function("self", code)(scope);
  return { listeners, navigated, opened, scope, shown, windows };
}

function waitUntil() {
  const promises: Promise<unknown>[] = [];
  return {
    done: () => Promise.all(promises),
    event: { waitUntil: (promise: Promise<unknown>) => promises.push(promise) }
  };
}

describe("push service worker", () => {
  it("shows the notification the restaurant sent, with a link inside the site", async () => {
    const { listeners, shown } = load();
    const pending = waitUntil();
    listeners.get("push")!({
      ...pending.event,
      data: {
        json: () => ({
          body: "Tu premio vence pronto",
          category: "operational",
          title: "La Parrilla",
          url: "/cuenta"
        })
      }
    });
    await pending.done();
    expect(shown).toEqual([
      {
        options: {
          body: "Tu premio vence pronto",
          data: { url: "/cuenta" },
          icon: "/api/brand/icon?size=192",
          tag: "operational"
        },
        title: "La Parrilla"
      }
    ]);
  });

  it("falls back to a plain notice and refuses a link to another site", async () => {
    const { listeners, shown } = load();
    for (const data of [
      { json: () => ({ url: "https://evil.example.com/x" }) },
      { json: () => ({ url: "//evil.example.com" }) },
      {
        json: () => {
          throw new Error("not json");
        }
      },
      null
    ]) {
      const pending = waitUntil();
      listeners.get("push")!({ ...pending.event, data });
      await pending.done();
    }
    expect(shown).toHaveLength(4);
    expect(shown.every((entry) => entry.title === "Aviso")).toBe(true);
    expect(
      shown.every(
        (entry) => (entry.options.data as { url: string }).url === "/cuenta"
      )
    ).toBe(true);
  });

  it("opens the page when the notification is tapped, reusing an open tab", async () => {
    const first = load();
    const pending = waitUntil();
    first.listeners.get("notificationclick")!({
      ...pending.event,
      notification: { close: vi.fn(), data: { url: "/cuenta" } }
    });
    await pending.done();
    expect(first.opened).toEqual(["https://local.example.test/cuenta"]);

    const second = load();
    const calls: string[] = [];
    second.windows.push({
      focus: () => {
        calls.push("focus");
        return Promise.resolve();
      },
      navigate: (url) => {
        calls.push(url);
        return Promise.resolve();
      },
      url: "https://local.example.test/m/abc"
    });
    const again = waitUntil();
    second.listeners.get("notificationclick")!({
      ...again.event,
      notification: { close: vi.fn(), data: { url: "//evil.example.com" } }
    });
    await again.done();
    expect(calls).toEqual(["focus", "https://local.example.test/cuenta"]);
    expect(second.opened).toEqual([]);
  });

  it("takes control at once and caches nothing", async () => {
    const { listeners, scope } = load();
    listeners.get("install")!({});
    expect(scope.skipWaiting).toHaveBeenCalled();
    expect(listeners.has("fetch")).toBe(false);
  });
});
