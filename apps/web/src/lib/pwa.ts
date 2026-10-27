/**
 * The one address the service worker is registered under. Push and the offline page use
 * the same worker, and registering it under two different addresses would make the
 * browser swap it back and forth. In production it caches the build files and the diner's
 * menu (see public/sw.js); in development it only offers the offline page and push, so
 * hot reloading never meets a stale file.
 */
export function serviceWorkerUrl(): string {
  const caching =
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_PWA_CACHE === "1";
  return caching ? "/sw.js?cache=1" : "/sw.js";
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(serviceWorkerUrl(), { scope: "/" });
}
