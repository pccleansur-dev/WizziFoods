/*
 * Service worker of the PWA.
 *
 * What it keeps, and what it never does:
 *  - The OFFLINE PAGE, always: a navigation that cannot reach the server shows it instead
 *    of the browser's error.
 *  - With `?cache=1` (production): the hashed build files under /_next/static/ (cache first,
 *    they never change under the same name) and the diner's menu page /m/<token> (network
 *    first, the last copy only when the network fails). The page that comes back says it
 *    may be old, offers no way to send an order, and asks the server again when the
 *    connection returns.
 *  - Nothing else. Staff screens, API answers, accounts, orders and anything that is not
 *    a GET are never cached and never answered from here: a write is not "sent" until the
 *    server confirms it.
 * When the connection returns the screens ask this worker to forget the cached reads.
 *
 * It also shows the push notifications the restaurant sends and opens the right page.
 */

const SHELL_CACHE = "shell-v1";
const READS_CACHE = "reads-v1";
const OFFLINE_URL = "/offline.html";
const MAX_READS = 12;
const cachingOn = new URL(self.location.href).searchParams.get("cache") === "1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== SHELL_CACHE && name !== READS_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "invalidate") {
    event.waitUntil(caches.delete(READS_CACHE));
  }
});

function offlinePage() {
  return caches.match(OFFLINE_URL).then(
    (cached) =>
      cached ||
      new Response("Sin conexión", {
        headers: { "content-type": "text/plain; charset=utf-8" },
        status: 503
      })
  );
}

/** The diner's menu: /m/<token>. Staff and account pages are private and never stored. */
function isDinerMenu(pathname) {
  return /^\/m\/[^/]+\/?$/.test(pathname);
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      const type = response.headers.get("content-type") || "";
      if (response.ok && type.includes("text/html")) {
        const copy = response.clone();
        caches.open(READS_CACHE).then(async (cache) => {
          await cache.put(request, copy);
          const keys = await cache.keys();
          for (const key of keys.slice(
            0,
            Math.max(0, keys.length - MAX_READS)
          )) {
            await cache.delete(key);
          }
        });
      }
      return response;
    })
    .catch(() =>
      caches
        .match(request, { cacheName: READS_CACHE })
        .then((cached) => cached || offlinePage())
    );
}

function cacheFirst(request) {
  return caches.match(request, { cacheName: SHELL_CACHE }).then(
    (cached) =>
      cached ||
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    if (cachingOn && isDinerMenu(url.pathname)) {
      event.respondWith(networkFirst(request));
    } else {
      event.respondWith(fetch(request).catch(() => offlinePage()));
    }
    return;
  }
  if (cachingOn && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else goes straight to the network.
});

/** Only a path of this very site: never another host, never `//host`. */
function safePath(value) {
  return typeof value === "string" &&
    /^\/(?![/\\])[\x21-\x7e]{0,199}$/.test(value)
    ? value
    : "/cuenta";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title =
    typeof data.title === "string" && data.title.length > 0
      ? data.title.slice(0, 80)
      : "Aviso";
  const options = {
    body: typeof data.body === "string" ? data.body.slice(0, 240) : "",
    // The restaurant's own logo: the same address on every host, answered per host.
    icon: "/api/brand/icon?size=192",
    data: { url: safePath(data.url) },
    // One notification per kind: a new one replaces the previous instead of piling up.
    tag: typeof data.category === "string" ? data.category : "aviso"
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    safePath(event.notification.data && event.notification.data.url),
    self.location.origin
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ includeUncontrolled: true, type: "window" })
      .then((windows) => {
        for (const client of windows) {
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            return client.focus().then(() => client.navigate(target));
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
