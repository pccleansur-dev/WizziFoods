import {
  parseOnlineCheckout,
  parseOnlinePaymentView,
  parseShareCheckout,
  parseSharePaymentView,
  type OnlineCheckout,
  type OnlinePaymentView,
  type ShareCheckout,
  type SharePaymentView
} from "@platform/contracts";

function dataOf(body: unknown): unknown {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).join() !== "data"
  ) {
    return undefined;
  }
  return (body as { data: unknown }).data;
}

export function parseOnlineCheckoutResponse(
  body: unknown
): OnlineCheckout | null {
  return parseOnlineCheckout(dataOf(body));
}

export function parseOnlinePaymentResponse(
  body: unknown
): OnlinePaymentView | null {
  return parseOnlinePaymentView(dataOf(body));
}

export function parseShareCheckoutResponse(body: unknown): ShareCheckout | null {
  return parseShareCheckout(dataOf(body));
}

export function parseSharePaymentResponse(
  body: unknown
): SharePaymentView | null {
  return parseSharePaymentView(dataOf(body));
}
