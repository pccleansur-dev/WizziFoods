import {
  parseDinerPushConfig,
  parseDinerPushState,
  type DinerPushConfig
} from "@platform/contracts";

const jsonHeaders = { "content-type": "application/json" };

export type PushSupport =
  "denied" | "ios-needs-install" | "ready" | "unsupported";

/** The key the browser subscribes with, from base64url to the bytes it expects. */
export function applicationServerKey(publicKey: string): Uint8Array {
  const padded = publicKey
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(publicKey.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** What the server needs from a browser subscription, or null if it is incomplete. */
export function subscriptionRequest(
  subscription: PushSubscriptionJSON
): { auth: string; endpoint: string; p256dh: string } | null {
  const { endpoint, keys } = subscription;
  return endpoint && keys?.auth && keys.p256dh
    ? { auth: keys.auth, endpoint, p256dh: keys.p256dh }
    : null;
}

/**
 * Can this browser show notifications? iPhones only do so for a page added to the
 * home screen, which we ask for instead of silently failing.
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const apple = /iPhone|iPad|iPod/u.test(navigator.userAgent);
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return apple && !standalone ? "ios-needs-install" : "unsupported";
  }
  return Notification.permission === "denied" ? "denied" : "ready";
}

export async function loadPushConfig(): Promise<DinerPushConfig | null> {
  try {
    const response = await fetch("/api/diner/push/config", {
      cache: "no-store"
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: unknown };
    return parseDinerPushConfig(body.data);
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown): Promise<boolean | null> {
  try {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: jsonHeaders,
      method: "POST"
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: unknown };
    return parseDinerPushState(json.data)?.subscribed ?? null;
  } catch {
    return null;
  }
}

/** Is THIS browser subscribed (and still known to the server)? */
export async function currentlySubscribed(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return false;
    return (
      (await post("/api/diner/push/subscriptions/state", {
        endpoint: subscription.endpoint
      })) === true
    );
  } catch {
    return false;
  }
}

export type EnableOutcome = "denied" | "failed" | "ok";

/** Asks permission, subscribes this browser and tells the server. Always the diner's act. */
export async function enablePush(publicKey: string): Promise<EnableOutcome> {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/"
    });
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        applicationServerKey: applicationServerKey(publicKey) as BufferSource,
        userVisibleOnly: true
      }));
    const request = subscriptionRequest(subscription.toJSON());
    if (!request) return "failed";
    return (await post("/api/diner/push/subscriptions", request)) === true
      ? "ok"
      : "failed";
  } catch {
    return "failed";
  }
}

export async function disablePush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return true;
    await post("/api/diner/push/subscriptions/revoke", {
      endpoint: subscription.endpoint
    });
    await subscription.unsubscribe();
    return true;
  } catch {
    return false;
  }
}
