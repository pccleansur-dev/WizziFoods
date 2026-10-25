import {
  parseOnlineCheckout,
  parseOnlinePaymentView,
  type OnlineCheckout,
  type OnlinePaymentView
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
