/*
 * Service worker of the PWA. For now it only shows the notifications the restaurant
 * sends (Web Push) and opens the right page when one is tapped. It caches nothing and
 * never touches a request: the menu, the login and the orders do not depend on it.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
