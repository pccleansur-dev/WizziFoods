import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;

/** An in-memory stand-in for the Cache API: enough for the worker's own use of it. */
function createCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: Request | string) =>
    typeof request === "string"
      ? new URL(request, "https://local.example.test").href
      : request.url;
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return Promise.resolve({
      add: async (request: Request | string) => {
        const response = await globalThis.fetch(
          typeof request === "string" ? request : request.url
        );
        store.set(key(request), response.clone());
      },
      delete: (request: Request | string) =>
        Promise.resolve(store.delete(key(request))),
      keys: () =>
        Promise.resolve([...store.keys()].map((url) => new Request(url))),
      match: (request: Request | string) =>
        Promise.resolve(store.get(key(request))?.clone()),
      put: (request: Request | string, response: Response) => {
        store.set(key(request), response);
        return Promise.resolve();
      }
    });
  };
  return {
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    match: (request: Request | string, options?: { cacheName?: string }) => {
      const names = options?.cacheName
        ? [options.cacheName]
        : [...stores.keys()];
      for (const name of names) {
        const found = stores.get(name)?.get(key(request));
        if (found) return Promise.resolve(found.clone());
      }
      return Promise.resolve(undefined);
    },
    names: () => [...stores.keys()],
    open,
    stores
  };
}

/**
 * Runs public/sw.js against a stand-in for the worker's global scope, with a network the
 * test can cut and a cache it can inspect.
 */
function load(search = "") {
  const listeners = new Map<string, Listener>();
  const shown: Array<{ options: Record<string, unknown>; title: string }> = [];
  const opened: string[] = [];
  const windows: Array<{
    focus: () => Promise<void>;
    navigate: (url: string) => Promise<void>;
    url: string;
  }> = [];
  const caches = createCaches();
  const network = {
    down: false,
    requests: [] as string[],
    responses: new Map<string, () => Response>()
  };
  const fetchMock = (input: Request | string) => {
    const url = typeof input === "string" ? input : input.url;
    network.requests.push(url);
    if (network.down) return Promise.reject(new TypeError("offline"));
    const make = network.responses.get(new URL(url).pathname);
    return Promise.resolve(
      make
        ? make()
        : new Response("ok", { headers: { "content-type": "text/plain" } })
    );
  };
  network.responses.set(
    "/offline.html",
    () =>
      new Response("<h1>Sin conexión</h1>", {
        headers: { "content-type": "text/html" }
      })
  );
  const scope = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve();
      }
    },
    location: {
      href: `https://local.example.test/sw.js${search}`,
      origin: "https://local.example.test"
    },
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
  // `fetch` inside add() above must reach the same network.
  const previous = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  new Function("self", "caches", "fetch", code)(scope, caches, fetchMock);
  return {
    caches,
    listeners,
    network,
    opened,
    restore: () => {
      globalThis.fetch = previous;
    },
    scope,
    shown,
    windows
  };
}

function waitUntil() {
  const promises: Promise<unknown>[] = [];
  return {
    done: () => Promise.all(promises),
    event: { waitUntil: (promise: Promise<unknown>) => promises.push(promise) }
  };
}

/** Sends a request through the worker; returns what it answered, or null if it let it pass. */
async function ask(
  worker: ReturnType<typeof load>,
  url: string,
  init: { method?: string; mode?: string } = {}
): Promise<Response | null> {
  let answer: Promise<Response> | null = null;
  const request = new Request(`https://local.example.test${url}`, {
    method: init.method ?? "GET"
  });
  Object.defineProperty(request, "mode", { value: init.mode ?? "same-origin" });
  worker.listeners.get("fetch")!({
    request,
    respondWith: (promise: Promise<Response>) => {
      answer = promise;
    }
  });
  return answer ? await answer : null;
}

async function installed(search = "") {
  const worker = load(search);
  const pending = waitUntil();
  worker.listeners.get("install")!(pending.event);
  await pending.done();
  return worker;
}

describe("push notifications", () => {
  it("shows the notification the restaurant sent, with its logo and a link inside the site", async () => {
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
});

describe("offline page", () => {
  it("is kept at install and takes control at once", async () => {
    const worker = await installed();
    expect(worker.scope.skipWaiting).toHaveBeenCalled();
    expect(worker.caches.names()).toEqual(["shell-v1"]);
    worker.restore();
  });

  it("forgets caches of older versions when it activates", async () => {
    const worker = await installed();
    await worker.caches.open("shell-v0");
    const pending = waitUntil();
    worker.listeners.get("activate")!(pending.event);
    await pending.done();
    expect(worker.caches.names()).toEqual(["shell-v1"]);
    expect(worker.scope.clients.claim).toHaveBeenCalled();
    worker.restore();
  });

  it("shows it when a page cannot be reached, and never touches a page that can", async () => {
    const worker = await installed();
    worker.network.responses.set(
      "/interno/negocio/operacion",
      () =>
        new Response("<h1>Operación</h1>", {
          headers: { "content-type": "text/html" }
        })
    );
    const online = await ask(worker, "/interno/negocio/operacion", {
      mode: "navigate"
    });
    expect(await online!.text()).toContain("Operación");
    worker.network.down = true;
    const offline = await ask(worker, "/interno/negocio/operacion", {
      mode: "navigate"
    });
    expect(await offline!.text()).toContain("Sin conexión");
    worker.restore();
  });

  it("does not answer anything that is not a page, even offline", async () => {
    const worker = await installed("?cache=1");
    worker.network.down = true;
    for (const [url, init] of [
      ["/v1/staff/accounts", {}],
      ["/api/order-intents", { method: "POST" }],
      ["/interno/negocio/operacion/vista", {}],
      ["/interno/negocio/operacion/tiempo-real", { method: "POST" }],
      ["/api/brand/icon?size=192", {}],
      ["/m/abc", { method: "POST", mode: "navigate" }]
    ] as const) {
      expect(await ask(worker, url, init)).toBeNull();
    }
    worker.restore();
  });
});

describe("cache policy", () => {
  it("caches nothing but the offline page while caching is off", async () => {
    const worker = await installed();
    await ask(worker, "/_next/static/chunks/app-abc123.js");
    worker.network.responses.set(
      "/m/abc",
      () =>
        new Response("<h1>Carta</h1>", {
          headers: { "content-type": "text/html" }
        })
    );
    await ask(worker, "/m/abc", { mode: "navigate" });
    worker.network.down = true;
    expect(await ask(worker, "/_next/static/chunks/app-abc123.js")).toBeNull();
    expect(
      await (await ask(worker, "/m/abc", { mode: "navigate" }))!.text()
    ).toContain("Sin conexión");
    expect(worker.caches.names()).toEqual(["shell-v1"]);
    worker.restore();
  });

  it("keeps build files first, so a screen opens without the network", async () => {
    const worker = await installed("?cache=1");
    worker.network.responses.set(
      "/_next/static/chunks/app-abc123.js",
      () =>
        new Response("code", { headers: { "content-type": "text/javascript" } })
    );
    expect(
      await (await ask(worker, "/_next/static/chunks/app-abc123.js"))!.text()
    ).toBe("code");
    worker.network.down = true;
    expect(
      await (await ask(worker, "/_next/static/chunks/app-abc123.js"))!.text()
    ).toBe("code");
    worker.restore();
  });

  it("serves the last menu only when the network fails, and forgets it when told to", async () => {
    const worker = await installed("?cache=1");
    worker.network.responses.set(
      "/m/abc",
      () =>
        new Response("<h1>Carta del martes</h1>", {
          headers: { "content-type": "text/html" }
        })
    );
    expect(
      await (await ask(worker, "/m/abc", { mode: "navigate" }))!.text()
    ).toContain("martes");
    await Promise.resolve();
    worker.network.responses.set(
      "/m/abc",
      () =>
        new Response("<h1>Carta del miércoles</h1>", {
          headers: { "content-type": "text/html" }
        })
    );
    // Online, the fresh one always wins.
    expect(
      await (await ask(worker, "/m/abc", { mode: "navigate" }))!.text()
    ).toContain("miércoles");
    await new Promise((resolve) => setTimeout(resolve, 0));
    worker.network.down = true;
    expect(
      await (await ask(worker, "/m/abc", { mode: "navigate" }))!.text()
    ).toContain("miércoles");

    // The connection returned: everything remembered is dropped.
    const pending = waitUntil();
    worker.listeners.get("message")!({
      ...pending.event,
      data: { type: "invalidate" }
    });
    await pending.done();
    expect(
      await (await ask(worker, "/m/abc", { mode: "navigate" }))!.text()
    ).toContain("Sin conexión");
    worker.restore();
  });

  it("never stores a staff or account page", async () => {
    const worker = await installed("?cache=1");
    for (const url of ["/interno/negocio/operacion", "/cuenta", "/panel"]) {
      worker.network.responses.set(
        url,
        () =>
          new Response("<h1>Privado</h1>", {
            headers: { "content-type": "text/html" }
          })
      );
      await ask(worker, url, { mode: "navigate" });
    }
    worker.network.down = true;
    for (const url of ["/interno/negocio/operacion", "/cuenta", "/panel"]) {
      expect(
        await (await ask(worker, url, { mode: "navigate" }))!.text()
      ).toContain("Sin conexión");
    }
    expect(worker.caches.names()).toEqual(["shell-v1"]);
    worker.restore();
  });
});
